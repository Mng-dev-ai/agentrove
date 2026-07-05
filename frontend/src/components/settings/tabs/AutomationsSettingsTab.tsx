import { Suspense, useCallback, useMemo, useState } from 'react';
import { Clock, Cloud, Play } from 'lucide-react';
import toast from 'react-hot-toast';
import { ListManagementTab } from '@/components/ui/ListManagementTab';
import { Button } from '@/components/ui/primitives/Button';
import { Switch } from '@/components/ui/primitives/Switch';
import { useSettingsContext } from '@/hooks/useSettingsContext';
import { useCloudSettingsStore } from '@/store/cloudSettingsStore';
import { useCloudSettingsQuery } from '@/hooks/queries/useCloudQueries';
import {
  useAutomationsQuery,
  useCloudAutomationsQuery,
  useCreateAutomationMutation,
  useUpdateAutomationMutation,
  useDeleteAutomationMutation,
  useRunAutomationMutation,
} from '@/hooks/queries/useAutomationQueries';
import {
  DEFAULT_PERMISSION_MODE,
  DEFAULT_THINKING_MODE,
  DEFAULT_WORKTREE,
  DEFAULT_PLAN_MODE,
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

const AutomationEditDialog = lazyNamed(
  () => import('@/components/settings/dialogs/AutomationEditDialog'),
  'AutomationEditDialog',
);

// An automation belongs to one backend; onCloud tags each row with its origin
// so edits/deletes/runs route back to it.
interface AutomationListItem {
  automation: Automation;
  onCloud: boolean;
}

const NEXT_RUN_FORMAT: Intl.DateTimeFormatOptions = {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
};

function createDefaultForm(): AutomationForm {
  return {
    name: '',
    prompt: '',
    model_id: '',
    workspace_id: '',
    schedule: { ...DEFAULT_SCHEDULE },
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    permission_mode: DEFAULT_PERMISSION_MODE,
    thinking_mode: DEFAULT_THINKING_MODE,
    worktree: DEFAULT_WORKTREE,
    plan_mode: DEFAULT_PLAN_MODE,
    persona_name: DEFAULT_PERSONA,
    onCloud: false,
  };
}

function formFromItem(item: AutomationListItem): AutomationForm {
  const { automation } = item;
  return {
    name: automation.name,
    prompt: automation.prompt,
    model_id: automation.model_id,
    workspace_id: automation.workspace_id,
    schedule: parseCronExpression(automation.cron_expression),
    // Keep the zone the schedule was authored in — editing from another
    // timezone must not silently shift the automation's wall-clock time.
    timezone: automation.timezone,
    permission_mode: automation.permission_mode,
    thinking_mode: automation.thinking_mode ?? '',
    worktree: automation.worktree,
    plan_mode: automation.plan_mode,
    persona_name: automation.selected_persona_name,
    onCloud: item.onCloud,
  };
}

export const AutomationsSettingsTab: React.FC = () => {
  const { localSettings } = useSettingsContext();
  const cloudUrl = useCloudSettingsStore((state) => state.cloudUrl);
  const cloudConnected = !!cloudUrl;

  const { data: localAutomations } = useAutomationsQuery();
  const { data: cloudAutomations } = useCloudAutomationsQuery(cloudConnected);
  const { data: cloudSettings } = useCloudSettingsQuery(cloudConnected);
  const modelMap = useModelMap();

  const createMutation = useCreateAutomationMutation();
  const updateMutation = useUpdateAutomationMutation();
  const deleteMutation = useDeleteAutomationMutation();
  const runMutation = useRunAutomationMutation();

  const items = useMemo<AutomationListItem[] | null>(() => {
    if (!localAutomations) return null;
    return [
      ...localAutomations.map((automation) => ({ automation, onCloud: false })),
      ...(cloudAutomations ?? []).map((automation) => ({ automation, onCloud: true })),
    ];
  }, [localAutomations, cloudAutomations]);

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<AutomationListItem | null>(null);
  const [form, setForm] = useState<AutomationForm>(createDefaultForm);
  const [formError, setFormError] = useState<string | null>(null);

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
      onCloud: item.onCloud,
    });
  };

  const handleSave = async () => {
    const onCloud = editingItem?.onCloud ?? form.onCloud;
    const personas = (onCloud ? cloudSettings?.personas : localSettings.personas) ?? [];
    // Coerce raw form settings to the selected model's agent, same as normal
    // sends — a stale mode from another agent family would fail at run time.
    const agentFields = buildAgentChatFields(
      form.model_id,
      modelMap,
      {
        permissionMode: form.permission_mode,
        thinkingMode: form.thinking_mode,
        worktree: form.worktree,
        planMode: form.plan_mode,
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
      plan_mode: agentFields.plan_mode ?? false,
      selected_persona_name: agentFields.selected_persona_name,
      enabled: editingItem?.automation.enabled ?? true,
    };
    try {
      if (editingItem) {
        await updateMutation.mutateAsync({
          automationId: editingItem.automation.id,
          data,
          onCloud: editingItem.onCloud,
        });
      } else {
        await createMutation.mutateAsync({ data, onCloud: form.onCloud });
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
        onCloud: item.onCloud,
      });
    } catch {
      toast.error('Failed to update automation');
    }
  };

  const handleRunNow = async (item: AutomationListItem) => {
    try {
      await runMutation.mutateAsync({
        automationId: item.automation.id,
        onCloud: item.onCloud,
      });
      toast.success(`"${item.automation.name}" started — check the sidebar for its chat`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to run automation');
    }
  };

  return (
    <>
      <ListManagementTab<AutomationListItem>
        title="Automations"
        description="Scheduled prompts that start a new chat with your chosen model, workspace, and settings — e.g. check email daily or triage errors every 6 hours."
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
        renderItem={(item) => (
          <>
            <div className="mb-2 flex items-center gap-2">
              <h3 className="truncate text-xs font-medium text-text-primary dark:text-text-dark-primary">
                {item.automation.name}
              </h3>
              {item.onCloud && (
                <span className="flex items-center gap-1 rounded-md border border-border/50 px-1.5 py-0.5 text-2xs text-text-tertiary dark:border-border-dark/50 dark:text-text-dark-tertiary">
                  <Cloud className="h-3 w-3" />
                  Cloud
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2 font-mono text-2xs text-text-secondary dark:text-text-dark-secondary">
              <span className="rounded-md border border-border/50 px-1.5 py-0.5 dark:border-border-dark/50">
                {item.automation.model_id}
              </span>
              <span className="rounded-md border border-border/50 px-1.5 py-0.5 dark:border-border-dark/50">
                {describeCron(item.automation.cron_expression)}
              </span>
              {item.automation.enabled && (
                <span className="text-text-quaternary dark:text-text-dark-quaternary">
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
              className="rounded-md p-1.5 text-text-quaternary transition-colors duration-200 hover:text-text-primary disabled:opacity-50 dark:text-text-dark-quaternary dark:hover:text-text-dark-primary"
              aria-label="Run now"
              title="Run now"
            >
              <Play className="h-3.5 w-3.5" />
            </Button>
            <Switch
              size="sm"
              className="mr-1.5"
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
            localPersonas={localSettings.personas ?? []}
            cloudPersonas={cloudSettings?.personas ?? []}
            cloudConnected={cloudConnected}
            error={formError}
            isSaving={createMutation.isPending || updateMutation.isPending}
            onClose={() => setIsDialogOpen(false)}
            onSubmit={() => void handleSave()}
            onChange={handleFormChange}
          />
        </Suspense>
      )}
    </>
  );
};
