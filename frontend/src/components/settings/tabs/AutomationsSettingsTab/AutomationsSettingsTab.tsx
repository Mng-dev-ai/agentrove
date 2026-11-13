import { Suspense, useCallback, useMemo, useState } from 'react';
import { Clock, Server, Play } from 'lucide-react';
import toast from 'react-hot-toast';
import { useQueryClient } from '@tanstack/react-query';
import { ListManagementTab } from '@/components/ui/ListManagementTab/ListManagementTab';
import { Button } from '@/components/ui/primitives/Button/Button';
import { Switch } from '@/components/ui/primitives/Switch/Switch';
import { useSettingsContext } from '@/hooks/useSettingsContext';
import { useMachineFilter } from '@/hooks/useMachineFilter';
import { LOCAL_MACHINE_NAME, useMachineStore } from '@/store/machineStore';
import { useMachineSettingsQuery } from '@/hooks/queries/useMachineQueries';
import { useMachineChannelsQuery } from '@/hooks/queries/useChannelQueries';
import { queryKeys } from '@/hooks/queries/queryKeys';
import { LOCAL_MACHINE_ID } from '@/types/machine.types';
import {
  useAutomationsAcrossMachines,
  type MachineAutomation,
  useCreateAutomationMutation,
  useUpdateAutomationMutation,
  useDeleteAutomationMutation,
  useRunAutomationMutation,
} from '@/hooks/queries/useAutomationQueries';
import {
  DEFAULT_PERMISSION_MODE,
  DEFAULT_THINKING_MODE,
  DEFAULT_WORKTREE,
  DEFAULT_PERSONA,
} from '@/store/chatSettingsStore';
import { useModelMap } from '@/hooks/queries/useModelQueries';
import { buildAgentChatFields } from '@/utils/chatRequest';
import {
  buildCronExpression,
  describeCron,
  parseCronExpression,
  DEFAULT_SCHEDULE,
} from '@/utils/automationSchedule';
import { lazyNamed } from '@/utils/lazyNamed';
import type {
  Automation,
  AutomationCreateRequest,
  AutomationForm,
  AutomationUpdateRequest,
} from '@/types/automation.types';
import type { Channel } from '@/types/channel.types';
import styles from './AutomationsSettingsTab.module.scss';

const NEXT_RUN_FORMAT: Intl.DateTimeFormatOptions = {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
};

const AutomationEditDialog = lazyNamed(
  () => import('@/components/settings/dialogs/AutomationEditDialog/AutomationEditDialog'),
  'AutomationEditDialog',
);

type AutomationListItem = MachineAutomation;

function createDefaultForm(): AutomationForm {
  return {
    name: '',
    prompt: '',
    model_id: '',
    workspace_id: '',
    target: 'chat',
    channel_id: '',
    schedule: { ...DEFAULT_SCHEDULE },
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    permission_mode: DEFAULT_PERMISSION_MODE,
    thinking_mode: DEFAULT_THINKING_MODE,
    worktree: DEFAULT_WORKTREE,
    persona_name: DEFAULT_PERSONA,
    machineId: LOCAL_MACHINE_ID,
  };
}

function formFromItem(item: AutomationListItem): AutomationForm {
  const { automation } = item;
  return {
    name: automation.name,
    prompt: automation.prompt,
    model_id: automation.model_id,
    workspace_id: automation.workspace_id,
    target: automation.channel_id ? 'channel' : 'chat',
    channel_id: automation.channel_id ?? '',
    schedule: parseCronExpression(automation.cron_expression),
    // Keep the zone the schedule was authored in — editing from another
    // timezone must not silently shift the automation's wall-clock time.
    timezone: automation.timezone,
    permission_mode: automation.permission_mode,
    thinking_mode: automation.thinking_mode ?? '',
    worktree: automation.worktree,
    persona_name: automation.selected_persona_name,
    machineId: item.machineId,
  };
}

function requestFromAutomation(automation: Automation): AutomationCreateRequest {
  return {
    name: automation.name,
    prompt: automation.prompt,
    model_id: automation.model_id,
    workspace_id: automation.workspace_id,
    channel_id: automation.channel_id ?? null,
    cron_expression: automation.cron_expression,
    timezone: automation.timezone,
    permission_mode: automation.permission_mode,
    thinking_mode: automation.thinking_mode,
    worktree: automation.worktree,
    selected_persona_name: automation.selected_persona_name,
    enabled: automation.enabled,
  };
}

function AutomationTargetChip({ machineId, channelId }: { machineId: string; channelId: string }) {
  const { data: channels } = useMachineChannelsQuery(machineId, true);
  if (!channels) return null;
  const channel = channels.find((candidate) => candidate.id === channelId);
  return channel ? (
    <span className={`${styles.chip} ${styles['target-chip']}`} title={`#${channel.name}`}>
      → #{channel.name}
    </span>
  ) : (
    <span className={`${styles.chip} ${styles['target-missing']}`}>target channel missing</span>
  );
}

export function AutomationsSettingsTab() {
  const { localSettings } = useSettingsContext();
  const allItems = useAutomationsAcrossMachines();
  const machines = useMachineStore((state) => state.machines);
  const connections = useMachineStore((state) => state.connections);
  const machineNames = useMemo(
    () => new Map(machines.map((machine) => [machine.id, machine.name])),
    [machines],
  );
  const machineOptions = useMemo(
    () => [
      { id: LOCAL_MACHINE_ID, name: LOCAL_MACHINE_NAME },
      ...machines
        .filter((machine) => connections[machine.id]?.status === 'online')
        .map((machine) => ({ id: machine.id, name: machine.name })),
    ],
    [machines, connections],
  );
  const { machineId: machineFilter, filter } = useMachineFilter(
    machineOptions,
    'No automations match these filters',
  );
  const items = useMemo(
    () =>
      machineFilter && allItems
        ? allItems.filter((item) => item.machineId === machineFilter)
        : allItems,
    [allItems, machineFilter],
  );
  const modelMap = useModelMap();
  const queryClient = useQueryClient();

  const createMutation = useCreateAutomationMutation();
  const updateMutation = useUpdateAutomationMutation();
  const deleteMutation = useDeleteAutomationMutation();
  const runMutation = useRunAutomationMutation();

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<AutomationListItem | null>(null);
  const [form, setForm] = useState<AutomationForm>(createDefaultForm);
  const [formError, setFormError] = useState<string | null>(null);
  const formMachineId = editingItem?.machineId ?? form.machineId;
  const { data: formMachineSettings } = useMachineSettingsQuery(
    formMachineId,
    isDialogOpen && formMachineId !== LOCAL_MACHINE_ID,
  );
  const formPersonas =
    (formMachineId === LOCAL_MACHINE_ID ? localSettings.personas : formMachineSettings?.personas) ??
    [];

  const handleFormChange = useCallback(
    <K extends keyof AutomationForm>(field: K, value: AutomationForm[K]) => {
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

  const handleEdit = (index: number) => {
    const item = items?.[index];
    if (!item) return;
    setEditingItem(item);
    setForm(formFromItem(item));
    setFormError(null);
    setIsDialogOpen(true);
  };

  const handleDelete = async (index: number) => {
    const item = items?.[index];
    if (!item) return;
    await deleteMutation.mutateAsync({
      automationId: item.automation.id,
      machineId: item.machineId,
    });
  };

  const handleSave = async () => {
    const personas = formPersonas;
    // Coerce raw form settings to the selected model's agent, same as normal
    // sends — a stale mode from another agent family would fail at run time.
    const agentFields = buildAgentChatFields(
      form.model_id,
      modelMap,
      {
        permissionMode: form.permission_mode,
        thinkingMode: form.thinking_mode,
        worktree: form.worktree,
        // Automations don't expose a Fast mode control yet.
        fastMode: false,
        persona: form.persona_name,
      },
      personas,
    );
    const data: AutomationCreateRequest = {
      name: form.name.trim(),
      prompt: form.prompt,
      model_id: form.model_id,
      workspace_id: form.workspace_id,
      cron_expression: buildCronExpression(form.schedule),
      timezone: form.timezone,
      permission_mode: agentFields.permission_mode,
      thinking_mode: agentFields.thinking_mode || null,
      worktree: agentFields.worktree ?? false,
      selected_persona_name: agentFields.selected_persona_name,
      enabled: editingItem?.automation.enabled ?? true,
      channel_id: form.target === 'channel' ? form.channel_id : null,
    };
    const machineId = editingItem?.machineId ?? form.machineId;
    try {
      const saved = editingItem
        ? await updateMutation.mutateAsync({
            automationId: editingItem.automation.id,
            data,
            machineId,
          })
        : await createMutation.mutateAsync({ data, machineId });
      if (data.channel_id && saved.channel_id !== data.channel_id) {
        const name =
          machineId === LOCAL_MACHINE_ID
            ? LOCAL_MACHINE_NAME
            : (machineNames.get(machineId) ?? 'This machine');
        const unsupported = `${name}'s backend does not support channel targets — update AgentRove on that machine.`;
        try {
          if (editingItem) {
            await updateMutation.mutateAsync({
              automationId: saved.id,
              data: requestFromAutomation(editingItem.automation),
              machineId,
            });
          } else {
            await deleteMutation.mutateAsync({ automationId: saved.id, machineId });
          }
        } catch {
          setIsDialogOpen(false);
          toast.error(
            editingItem
              ? `${unsupported} "${editingItem.automation.name}" kept the edited values, which could not be restored — edit it back.`
              : `${unsupported} "${saved.name}" was created as a chat automation and could not be removed — delete it from the list.`,
            { duration: 15_000 },
          );
          return;
        }
        throw new Error(unsupported);
      }
      setIsDialogOpen(false);
      toast.success('Saved', { id: 'automation-saved' });
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Failed to save automation');
    }
  };

  const handleToggle = async (item: AutomationListItem, enabled: boolean) => {
    const patch: AutomationUpdateRequest = { enabled };
    try {
      await updateMutation.mutateAsync({
        automationId: item.automation.id,
        data: patch,
        machineId: item.machineId,
      });
    } catch {
      toast.error('Failed to update automation');
    }
  };

  const handleRunNow = async (item: AutomationListItem) => {
    try {
      const result = await runMutation.mutateAsync({
        automationId: item.automation.id,
        machineId: item.machineId,
      });
      const channel = queryClient
        .getQueryData<Channel[]>(queryKeys.channels(item.machineId))
        ?.find((candidate) => candidate.id === result.channel_id);
      const channelName = `#${channel?.name ?? 'its channel'}`;
      toast.success(
        !result.channel_id
          ? `"${item.automation.name}" started — check the sidebar for its chat`
          : result.queued === false
            ? `"${item.automation.name}" not posted again — its previous run is still waiting in ${channelName}`
            : `"${item.automation.name}" posted to ${channelName}`,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to run automation');
    }
  };

  return (
    <>
      <ListManagementTab<AutomationListItem>
        title="Automations"
        description="Scheduled prompts that start a new chat with your chosen model, workspace, and settings, or post into a channel — e.g. check email daily or triage errors every 6 hours."
        items={items}
        emptyIcon={Clock}
        emptyText="No automations configured yet"
        emptyButtonText="Add your first automation"
        addButtonText="Add automation"
        deleteConfirmTitle="Delete automation"
        deleteConfirmMessage={(item) =>
          `Are you sure you want to delete "${item.automation.name}"? This action cannot be undone.`
        }
        getItemKey={(item) => item.automation.id}
        onAdd={handleAdd}
        onEdit={handleEdit}
        onDelete={handleDelete}
        filter={filter}
        renderItem={(item) => (
          <>
            <div className={styles['item-header']}>
              <h3 className={styles['item-title']}>{item.automation.name}</h3>
              {item.machineId !== LOCAL_MACHINE_ID && (
                <span className={styles['machine-badge']}>
                  <Server className={styles['machine-icon']} />
                  {machineNames.get(item.machineId) ?? 'Machine'}
                </span>
              )}
            </div>
            <div className={styles['item-meta']}>
              {item.automation.channel_id ? (
                <AutomationTargetChip
                  machineId={item.machineId}
                  channelId={item.automation.channel_id}
                />
              ) : (
                <span className={styles.chip}>{item.automation.model_id}</span>
              )}
              <span className={styles.chip}>{describeCron(item.automation.cron_expression)}</span>
              {item.automation.enabled && (
                <span className={styles['next-run']}>
                  Next run{' '}
                  {new Date(item.automation.next_run_at).toLocaleString([], NEXT_RUN_FORMAT)}
                </span>
              )}
            </div>
          </>
        )}
        renderItemActions={(item) => (
          <>
            <Button
              variant="unstyled"
              onClick={() => void handleRunNow(item)}
              disabled={runMutation.isPending}
              className={styles['run-button']}
              aria-label="Run now"
              title="Run now"
            >
              <Play className={styles['run-icon']} />
            </Button>
            <Switch
              size="sm"
              className={styles.toggle}
              checked={item.automation.enabled}
              onCheckedChange={(enabled) => void handleToggle(item, enabled)}
              aria-label={item.automation.enabled ? 'Disable automation' : 'Enable automation'}
            />
          </>
        )}
        logContext="AutomationsSettingsTab"
      />
      {isDialogOpen && (
        <Suspense fallback={null}>
          <AutomationEditDialog
            isOpen={isDialogOpen}
            isEditing={editingItem !== null}
            form={form}
            personas={formPersonas}
            machineOptions={machineOptions}
            error={formError}
            isSaving={
              createMutation.isPending || updateMutation.isPending || deleteMutation.isPending
            }
            onClose={() => setIsDialogOpen(false)}
            onSubmit={() => void handleSave()}
            onChange={handleFormChange}
          />
        </Suspense>
      )}
    </>
  );
}
