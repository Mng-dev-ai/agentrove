import { Suspense, useCallback, useMemo, useState } from 'react';
import { Key, Server } from 'lucide-react';
import toast from 'react-hot-toast';
import { useQueryClient } from '@tanstack/react-query';
import { ListManagementTab } from '@/components/ui/ListManagementTab/ListManagementTab';
import { useSettingsContext } from '@/hooks/useSettingsContext';
import { useMachineFilter } from '@/hooks/useMachineFilter';
import { queryKeys } from '@/hooks/queries/queryKeys';
import {
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
import { createDefaultEnvVarForm, validateEnvVarForm } from '@/utils/settings';
import { lazyNamed } from '@/utils/lazyNamed';
import { logger } from '@/utils/logger';
import type { CustomEnvVar, EnvVarForm } from '@/types/user.types';
import styles from './EnvVarsSettingsTab.module.scss';

const EnvVarDialog = lazyNamed(
  () => import('@/components/settings/dialogs/EnvVarDialog/EnvVarDialog'),
  'EnvVarDialog',
);

interface MachineEnvVar {
  envVar: CustomEnvVar;
  machineId: string;
}

const maskValue = (value: string) => {
  if (value.length <= 4) return '····';
  return `${value.slice(0, 4)}${'·'.repeat(Math.min(value.length - 4, 16))}`;
};

function createDefaultForm(): EnvVarForm {
  return { ...createDefaultEnvVarForm(), machineId: LOCAL_MACHINE_ID };
}

function saveEnvVar(envVars: CustomEnvVar[], editingKey: string | null, envVar: CustomEnvVar) {
  const index = editingKey === null ? null : envVars.findIndex((v) => v.key === editingKey);
  if (index === -1) throw new ValidationError('This variable no longer exists');
  const error = validateEnvVarForm(envVar, index, envVars);
  if (error) throw new ValidationError(error);
  return index === null ? [...envVars, envVar] : envVars.map((v, i) => (i === index ? envVar : v));
}

function deleteEnvVar(envVars: CustomEnvVar[], key: string) {
  if (!envVars.some((v) => v.key === key)) {
    throw new ValidationError('This variable no longer exists');
  }
  const remaining = envVars.filter((v) => v.key !== key);
  return remaining.length > 0 ? remaining : null;
}

export function EnvVarsSettingsTab() {
  const { localSettings, persistSettings } = useSettingsContext();
  const remoteIds = useOnlineRemoteMachineIds();
  const { byMachine: remoteEnvVars, load: remoteLoad } = useMachinesSettingsList(
    remoteIds,
    'custom_env_vars',
  );
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
  const envVarsByMachine = useMemo(
    (): Record<string, CustomEnvVar[]> => ({
      ...remoteEnvVars,
      [LOCAL_MACHINE_ID]: localSettings.custom_env_vars ?? [],
    }),
    [remoteEnvVars, localSettings.custom_env_vars],
  );
  const { machineId: machineFilter, filter } = useMachineFilter(
    machineOptions,
    'No environment variables match these filters',
  );
  const items = useMemo(
    (): MachineEnvVar[] =>
      machineOptions
        .filter((machine) => !machineFilter || machine.id === machineFilter)
        .flatMap((machine) =>
          (envVarsByMachine[machine.id] ?? []).map((envVar) => ({
            envVar,
            machineId: machine.id,
          })),
        ),
    [machineOptions, envVarsByMachine, machineFilter],
  );

  const machineName = (machineId: string) => machineNames.get(machineId) ?? 'Machine';
  const queryClient = useQueryClient();
  const remoteMutation = useUpdateMachineSettingsMutation({
    scope: { id: 'machine-env-vars' },
    onError: (_error, { machineId }) =>
      queryClient.invalidateQueries({ queryKey: queryKeys.machine.settings(machineId) }),
  });

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<MachineEnvVar | null>(null);
  const [form, setForm] = useState<EnvVarForm>(createDefaultForm);
  const [formError, setFormError] = useState<string | null>(null);

  const handleFormChange = useCallback(
    <K extends keyof EnvVarForm>(field: K, value: EnvVarForm[K]) => {
      setForm((prev) => ({ ...prev, [field]: value }));
    },
    [],
  );

  const handleAdd = () => {
    setEditingItem(null);
    setForm(createDefaultForm());
    setFormError(null);
    setIsDialogOpen(true);
  };

  const writeEnvVars = async (
    machineId: string,
    update: (envVars: CustomEnvVar[]) => CustomEnvVar[] | null,
    errorMessage: string,
  ) => {
    if (machineId === LOCAL_MACHINE_ID) {
      await persistSettings(
        (prev) => ({ ...prev, custom_env_vars: update(prev.custom_env_vars ?? []) }),
        { errorMessage, versioned: true },
      );
      return;
    }
    try {
      await remoteMutation.mutateAsync({
        machineId,
        update: (settings) => ({ custom_env_vars: update(settings.custom_env_vars ?? []) }),
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
    setForm({ ...item.envVar, machineId: item.machineId });
    setFormError(null);
    setIsDialogOpen(true);
  };

  const handleDelete = async (index: number) => {
    const item = items[index];
    if (!item) return;
    try {
      await writeEnvVars(
        item.machineId,
        (envVars) => deleteEnvVar(envVars, item.envVar.key),
        'Failed to delete environment variable',
      );
    } catch (error) {
      if (error instanceof ValidationError) toast.error(error.message);
      logger.error('Failed to delete environment variable', 'EnvVarsSettingsTab', error);
    }
  };

  const handleSave = async () => {
    const envVar: CustomEnvVar = { key: form.key, value: form.value };
    const editingKey = editingItem?.envVar.key ?? null;
    try {
      await writeEnvVars(
        form.machineId,
        (envVars) => saveEnvVar(envVars, editingKey, envVar),
        'Failed to save environment variable',
      );
      setIsDialogOpen(false);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'An unexpected error occurred');
    }
  };

  return (
    <>
      <ListManagementTab<MachineEnvVar>
        title="Environment Variables"
        description="Configure environment variables that will be available in every sandbox on the machine they are saved to. Perfect for API keys like OPENAI_API_KEY, GEMINI_API_KEY, etc."
        items={items}
        loadError={{ message: "Couldn't load environment variables", load: remoteLoad }}
        emptyIcon={Key}
        emptyText="No custom environment variables configured yet"
        addButtonText="Add Variable"
        deleteConfirmTitle="Delete Environment Variable"
        deleteConfirmMessage={(item) =>
          `Are you sure you want to delete "${item.envVar.key}"? This action cannot be undone.`
        }
        getItemKey={(item) => `${item.machineId}:${item.envVar.key}`}
        onAdd={handleAdd}
        onEdit={handleEdit}
        onDelete={handleDelete}
        filter={filter}
        renderItem={(item) => (
          <>
            <div className={styles['item-header']}>
              <h3 className={styles['item-key']}>{item.envVar.key}</h3>
              {item.machineId !== LOCAL_MACHINE_ID && (
                <span className={styles.chip} title={machineName(item.machineId)}>
                  <Server className={styles['chip-icon']} />
                  <span className={styles['chip-label']}>{machineName(item.machineId)}</span>
                </span>
              )}
            </div>
            <p className={styles['item-value']}>{maskValue(item.envVar.value)}</p>
          </>
        )}
        logContext="EnvVarsSettingsTab"
      />
      {isDialogOpen && (
        <Suspense fallback={null}>
          <EnvVarDialog
            isOpen={isDialogOpen}
            isEditing={editingItem !== null}
            envVar={form}
            machineOptions={machineOptions}
            error={formError}
            isSaving={remoteMutation.isPending}
            onClose={() => setIsDialogOpen(false)}
            onSubmit={() => void handleSave()}
            onEnvVarChange={handleFormChange}
          />
        </Suspense>
      )}
    </>
  );
}
