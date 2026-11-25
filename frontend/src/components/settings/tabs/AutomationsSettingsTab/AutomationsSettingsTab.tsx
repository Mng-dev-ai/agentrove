import { Suspense, useCallback, useMemo, useState } from 'react';
import { Clock, Server, Play } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  ListItemAction,
  ListManagementTab,
} from '@/components/ui/ListManagementTab/ListManagementTab';
import { Switch } from '@/components/ui/primitives/Switch/Switch';
import { useSettingsContext } from '@/hooks/useSettingsContext';
import { useMachineFilter } from '@/hooks/useMachineFilter';
import { LOCAL_MACHINE_NAME, useMachineStore } from '@/store/machineStore';
import { useSettingsQuery } from '@/hooks/queries/useSettingsQueries';
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
import { useModelMap, useModelsQuery } from '@/hooks/queries/useModelQueries';
import { memberDraftFrom, memberRequest, newMemberDraft } from '@/components/channels/memberDraft';
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

function createDefaultForm(machineId: string): AutomationForm {
  return {
    name: '',
    prompt: '',
    model_id: '',
    workspace_id: '',
    target: 'chat',
    members: [newMemberDraft()],
    schedule: { ...DEFAULT_SCHEDULE },
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    permission_mode: DEFAULT_PERMISSION_MODE,
    thinking_mode: DEFAULT_THINKING_MODE,
    worktree: DEFAULT_WORKTREE,
    persona_name: DEFAULT_PERSONA,
    machineId,
  };
}

function formFromItem(item: AutomationListItem): AutomationForm {
  const { automation } = item;
  return {
    name: automation.name,
    prompt: automation.prompt,
    model_id: automation.model_id,
    workspace_id: automation.workspace_id,
    target: automation.channel_members ? 'channel' : 'chat',
    members: automation.channel_members?.map(memberDraftFrom) ?? [newMemberDraft()],
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
    channel_members:
      automation.channel_members?.map((member) => ({
        model_id: member.model_id,
        display_name: member.display_name ?? undefined,
        permission_mode: member.permission_mode ?? undefined,
        persona: member.persona,
        thinking_mode: member.thinking_mode,
      })) ?? null,
    cron_expression: automation.cron_expression,
    timezone: automation.timezone,
    permission_mode: automation.permission_mode,
    thinking_mode: automation.thinking_mode,
    worktree: automation.worktree,
    selected_persona_name: automation.selected_persona_name,
    enabled: automation.enabled,
  };
}

export function AutomationsSettingsTab() {
  const { localSettings } = useSettingsContext();
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
  const { items, load } = useAutomationsAcrossMachines(machineFilter);
  const machineName = (machineId: string) => machineNames.get(machineId) ?? 'Machine';

  const createMutation = useCreateAutomationMutation();
  const updateMutation = useUpdateAutomationMutation();
  const deleteMutation = useDeleteAutomationMutation();
  const runMutation = useRunAutomationMutation();

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<AutomationListItem | null>(null);
  const [form, setForm] = useState<AutomationForm>(() => createDefaultForm(LOCAL_MACHINE_ID));
  const [formError, setFormError] = useState<string | null>(null);
  const formMachineId = editingItem?.machineId ?? form.machineId;
  const modelMap = useModelMap({ machineId: formMachineId });
  const { data: formModels = [] } = useModelsQuery({ machineId: formMachineId });
  const { data: formMachineSettings } = useSettingsQuery({
    machineId: formMachineId,
    enabled: isDialogOpen && formMachineId !== LOCAL_MACHINE_ID,
  });
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
    setForm(createDefaultForm(machineFilter ?? LOCAL_MACHINE_ID));
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
      channel_members:
        form.target === 'channel'
          ? form.members.map((member) => memberRequest(member, formModels, personas))
          : null,
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
      if (data.channel_members && !saved.channel_members) {
        const name =
          machineId === LOCAL_MACHINE_ID
            ? LOCAL_MACHINE_NAME
            : (machineNames.get(machineId) ?? 'This machine');
        const unsupported = `${name}'s backend does not support new-channel targets — update AgentRove on that machine.`;
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
      toast.success(
        `"${item.automation.name}" started — check the sidebar for its ${result.channel_id ? 'channel' : 'chat'}`,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to run automation');
    }
  };

  return (
    <>
      <ListManagementTab<AutomationListItem>
        title="Automations"
        description="Scheduled prompts that start a new chat with your chosen model, workspace, and settings, or a new channel with your chosen members — e.g. check email daily or triage errors every 6 hours."
        items={items}
        emptyIcon={Clock}
        emptyText="No automations configured yet"
        loadError={{ message: "Couldn't load automations", load }}
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
                <span className={styles['machine-badge']} title={machineName(item.machineId)}>
                  <Server className={styles['machine-icon']} />
                  <span className={styles['machine-badge-label']}>
                    {machineName(item.machineId)}
                  </span>
                </span>
              )}
            </div>
            <div className={styles['item-meta']}>
              {item.automation.channel_members ? (
                <span
                  className={`${styles.chip} ${styles['target-chip']}`}
                  title={item.automation.channel_members
                    .map((member) => member.display_name ?? member.model_id)
                    .join(', ')}
                >
                  → new channel · {item.automation.channel_members.length}{' '}
                  {item.automation.channel_members.length === 1 ? 'member' : 'members'}
                </span>
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
            <ListItemAction
              icon={Play}
              label="Run now"
              title="Run now"
              onClick={() => void handleRunNow(item)}
              disabled={runMutation.isPending}
            />
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
            personasLoaded={formMachineId === LOCAL_MACHINE_ID || formMachineSettings !== undefined}
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
