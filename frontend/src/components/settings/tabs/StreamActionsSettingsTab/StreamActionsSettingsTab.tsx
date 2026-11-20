import { Suspense, useCallback, useMemo, useState } from 'react';
import { GitBranch, Server } from 'lucide-react';
import toast from 'react-hot-toast';
import { useQueryClient } from '@tanstack/react-query';
import { ListManagementTab } from '@/components/ui/ListManagementTab/ListManagementTab';
import { Switch } from '@/components/ui/primitives/Switch/Switch';
import { useSettingsContext } from '@/hooks/useSettingsContext';
import { useMachineFilter } from '@/hooks/useMachineFilter';
import { queryKeys } from '@/hooks/queries/queryKeys';
import {
  useMachineSettingsQuery,
  useMachinesSettingsList,
  useUpdateMachineSettingsMutation,
} from '@/hooks/queries/useMachineQueries';
import {
  LOCAL_MACHINE_NAME,
  useMachineStore,
  useOnlineRemoteMachineIds,
} from '@/store/machineStore';
import { ValidationError } from '@/services/base/ServiceError';
import { LOCAL_MACHINE_ID } from '@/types/machine.types';
import { createDefaultStreamActionForm, validateStreamActionForm } from '@/utils/settings';
import { lazyNamed } from '@/utils/lazyNamed';
import { logger } from '@/utils/logger';
import type { StreamAction, StreamActionForm } from '@/types/user.types';
import styles from './StreamActionsSettingsTab.module.scss';

const StreamActionEditDialog = lazyNamed(
  () => import('@/components/settings/dialogs/StreamActionEditDialog/StreamActionEditDialog'),
  'StreamActionEditDialog',
);

interface MachineStreamAction {
  action: StreamAction;
  machineId: string;
}

function createDefaultForm(machineId: string): StreamActionForm {
  return { ...createDefaultStreamActionForm(), machineId };
}

function findAction(actions: StreamAction[], label: string) {
  const index = actions.findIndex((a) => a.label === label);
  if (index === -1) throw new ValidationError('This action no longer exists');
  return index;
}

function saveAction(actions: StreamAction[], editingLabel: string | null, action: StreamAction) {
  const index = editingLabel === null ? null : findAction(actions, editingLabel);
  const error = validateStreamActionForm(action, index, actions);
  if (error) throw new ValidationError(error);
  return index === null ? [...actions, action] : actions.map((a, i) => (i === index ? action : a));
}

function deleteAction(actions: StreamAction[], label: string) {
  const remaining = actions.filter((a) => a.label !== label);
  return remaining.length > 0 ? remaining : null;
}

function toggleAction(actions: StreamAction[], label: string, enabled: boolean) {
  const index = findAction(actions, label);
  return actions.map((a, i) => (i === index ? { ...a, enabled } : a));
}

export function StreamActionsSettingsTab() {
  const { localSettings, persistSettings } = useSettingsContext();
  const remoteIds = useOnlineRemoteMachineIds();
  const machines = useMachineStore((state) => state.machines);
  const machineNames = useMemo(
    () => new Map(machines.map((machine) => [machine.id, machine.name])),
    [machines],
  );
  const machineOptions = useMemo(
    () => [
      { id: LOCAL_MACHINE_ID, name: LOCAL_MACHINE_NAME },
      ...remoteIds.map((id) => ({ id, name: machineNames.get(id) ?? 'Machine' })),
    ],
    [remoteIds, machineNames],
  );
  const { machineId: machineFilter, filter } = useMachineFilter(
    machineOptions,
    'No stream actions match these filters',
  );
  const { byMachine: remoteActions, load: remoteLoad } = useMachinesSettingsList(
    remoteIds,
    'stream_actions',
    machineFilter,
  );
  const actionsByMachine = useMemo(
    (): Record<string, StreamAction[]> => ({
      ...remoteActions,
      [LOCAL_MACHINE_ID]: localSettings.stream_actions ?? [],
    }),
    [remoteActions, localSettings.stream_actions],
  );
  const items = useMemo(
    (): MachineStreamAction[] =>
      machineOptions
        .filter((machine) => !machineFilter || machine.id === machineFilter)
        .flatMap((machine) =>
          (actionsByMachine[machine.id] ?? []).map((action) => ({
            action,
            machineId: machine.id,
          })),
        ),
    [machineOptions, actionsByMachine, machineFilter],
  );

  const machineName = (machineId: string) => machineNames.get(machineId) ?? 'Machine';
  const queryClient = useQueryClient();
  const remoteMutation = useUpdateMachineSettingsMutation({
    scope: { id: 'machine-stream-actions' },
    onError: (_error, { machineId }) =>
      queryClient.invalidateQueries({ queryKey: queryKeys.machine.settings(machineId) }),
  });

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<MachineStreamAction | null>(null);
  const [form, setForm] = useState<StreamActionForm>(() => createDefaultForm(LOCAL_MACHINE_ID));
  const [formError, setFormError] = useState<string | null>(null);
  const isRemoteForm = form.machineId !== LOCAL_MACHINE_ID;
  const { data: remoteFormSettings } = useMachineSettingsQuery(
    form.machineId,
    isDialogOpen && isRemoteForm,
  );
  const formPersonas = (isRemoteForm ? remoteFormSettings : localSettings)?.personas ?? [];

  const handleFormChange = useCallback(
    <K extends keyof StreamActionForm>(field: K, value: StreamActionForm[K]) => {
      setForm((prev) => ({ ...prev, [field]: value }));
    },
    [],
  );

  const handleAdd = () => {
    setEditingItem(null);
    setForm(createDefaultForm(machineFilter ?? LOCAL_MACHINE_ID));
    setFormError(null);
    setIsDialogOpen(true);
  };

  const writeActions = async (
    machineId: string,
    update: (actions: StreamAction[]) => StreamAction[] | null,
    errorMessage: string,
  ) => {
    if (machineId === LOCAL_MACHINE_ID) {
      await persistSettings(
        (prev) => ({ ...prev, stream_actions: update(prev.stream_actions ?? []) }),
        { errorMessage, versioned: true },
      );
      return;
    }
    try {
      await remoteMutation.mutateAsync({
        machineId,
        update: (settings) => ({ stream_actions: update(settings.stream_actions ?? []) }),
      });
    } catch (error) {
      if (!(error instanceof ValidationError)) toast.error(errorMessage);
      throw error;
    }
    toast.success('Saved', { id: 'settings-saved' });
  };

  const handleEdit = (index: number) => {
    const item = items[index];
    if (!item) return;
    setEditingItem(item);
    setForm({ ...item.action, machineId: item.machineId });
    setFormError(null);
    setIsDialogOpen(true);
  };

  const handleDelete = async (index: number) => {
    const item = items[index];
    if (!item) return;
    try {
      await writeActions(
        item.machineId,
        (actions) => deleteAction(actions, item.action.label),
        'Failed to delete action',
      );
    } catch (error) {
      logger.error('Failed to delete action', 'StreamActionsSettingsTab', error);
    }
  };

  const handleToggle = async (item: MachineStreamAction, enabled: boolean) => {
    try {
      await writeActions(
        item.machineId,
        (actions) => toggleAction(actions, item.action.label, enabled),
        'Failed to update action',
      );
    } catch (error) {
      if (error instanceof ValidationError) toast.error(error.message);
      logger.error('Failed to update action', 'StreamActionsSettingsTab', error);
    }
  };

  const handleSave = async () => {
    const { machineId, ...action } = form;
    const editingLabel = editingItem?.action.label ?? null;
    try {
      await writeActions(
        machineId,
        (actions) => saveAction(actions, editingLabel, action),
        'Failed to save action',
      );
      setIsDialogOpen(false);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'An unexpected error occurred');
    }
  };

  return (
    <>
      <ListManagementTab<MachineStreamAction>
        title="Stream actions"
        description="Buttons shown when a thread finishes streaming. Each runs its command on the selected model in a new sub-thread."
        items={items}
        loadError={{ message: "Couldn't load stream actions", load: remoteLoad }}
        emptyIcon={GitBranch}
        emptyText="No stream actions configured yet"
        addButtonText="Add action"
        deleteConfirmTitle="Delete action"
        deleteConfirmMessage={(item) =>
          `Are you sure you want to delete "${item.action.label}"? This action cannot be undone.`
        }
        getItemKey={(item) => `${item.machineId}:${item.action.label}`}
        onAdd={handleAdd}
        onEdit={handleEdit}
        onDelete={handleDelete}
        filter={filter}
        renderItem={(item) => (
          <>
            <div className={styles['item-header']}>
              <h3 className={styles['item-title']}>{item.action.label}</h3>
              {item.machineId !== LOCAL_MACHINE_ID && (
                <span className={styles['machine-chip']} title={machineName(item.machineId)}>
                  <Server className={styles['chip-icon']} />
                  <span className={styles['chip-label']}>{machineName(item.machineId)}</span>
                </span>
              )}
            </div>
            <div className={styles['item-meta']}>
              <span className={styles.chip}>{item.action.model_id}</span>
              <span className={styles['item-command']}>{item.action.command}</span>
            </div>
          </>
        )}
        renderItemActions={(item) => (
          <Switch
            size="sm"
            className={styles.toggle}
            checked={item.action.enabled}
            onCheckedChange={(enabled) => void handleToggle(item, enabled)}
            aria-label={item.action.enabled ? 'Disable action' : 'Enable action'}
          />
        )}
        logContext="StreamActionsSettingsTab"
      />
      {isDialogOpen && (
        <Suspense fallback={null}>
          <StreamActionEditDialog
            isOpen={isDialogOpen}
            isEditing={editingItem !== null}
            action={form}
            machineOptions={machineOptions}
            personas={formPersonas}
            error={formError}
            isSaving={remoteMutation.isPending}
            onClose={() => setIsDialogOpen(false)}
            onSubmit={() => void handleSave()}
            onActionChange={handleFormChange}
          />
        </Suspense>
      )}
    </>
  );
}
