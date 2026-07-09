import { useEffect } from 'react';
import { Clock, Brain, Shield, Cloud, GitFork, Monitor } from 'lucide-react';
import type { Persona } from '@/types/user.types';
import type { AutomationForm } from '@/types/automation.types';
import { Input } from '@/components/ui/primitives/Input/Input';
import { Label } from '@/components/ui/primitives/Label/Label';
import { Select } from '@/components/ui/primitives/Select/Select';
import { Switch } from '@/components/ui/primitives/Switch/Switch';
import { Textarea } from '@/components/ui/primitives/Textarea/Textarea';
import { Dropdown } from '@/components/ui/primitives/Dropdown/Dropdown';
import { BaseModal } from '@/components/ui/shared/BaseModal';
import { DialogFooter } from '@/components/ui/shared/DialogFooter';
import { DialogError } from '@/components/ui/shared/DialogError';
import { ToggleDropdown, type ToggleDropdownOption } from '@/components/ui/shared/ToggleDropdown';
import { ModelSelector } from '@/components/chat/model-selector/ModelSelector';
import {
  getThinkingModesForAgent,
  getThinkingModeOption,
} from '@/components/chat/thinking-mode-selector/thinkingModes';
import {
  MODES_BY_AGENT,
  getPermissionModeOption,
} from '@/components/chat/permission-mode-selector/permissionModes';
import { useModelsQuery } from '@/hooks/queries/useModelQueries';
import { useWorkspacesList } from '@/hooks/queries/useWorkspaceQueries';
import { useCloudWorkspacesQuery } from '@/hooks/queries/useCloudQueries';
import { DEFAULT_PERSONA } from '@/store/chatSettingsStore';
import {
  buildCronExpression,
  describeCron,
  WEEKDAY_LABELS,
  type ScheduleForm,
  type ScheduleFrequency,
} from '@/utils/automationSchedule';

const RUN_LOCATION_OPTIONS: readonly [ToggleDropdownOption, ToggleDropdownOption] = [
  { label: 'Local', icon: Monitor },
  { label: 'Cloud', icon: Cloud },
];

const WORKTREE_OPTIONS: readonly [ToggleDropdownOption, ToggleDropdownOption] = [
  { label: 'No worktree' },
  { label: 'Worktree' },
];

interface AutomationEditDialogProps {
  isOpen: boolean;
  isEditing: boolean;
  form: AutomationForm;
  localPersonas: Persona[];
  cloudPersonas: Persona[];
  cloudConnected: boolean;
  error: string | null;
  isSaving: boolean;
  onClose: () => void;
  onSubmit: () => void;
  onChange: <K extends keyof AutomationForm>(field: K, value: AutomationForm[K]) => void;
}

export const AutomationEditDialog: React.FC<AutomationEditDialogProps> = ({
  isOpen,
  isEditing,
  form,
  localPersonas,
  cloudPersonas,
  cloudConnected,
  error,
  isSaving,
  onClose,
  onSubmit,
  onChange,
}) => {
  const { data: models = [] } = useModelsQuery();
  const localWorkspaces = useWorkspacesList();
  const { data: cloudWorkspaces = [] } = useCloudWorkspacesQuery(cloudConnected);

  const workspaces = form.onCloud ? cloudWorkspaces : localWorkspaces;
  const personas = form.onCloud ? cloudPersonas : localPersonas;

  // Form-state init: seed new automations and ones whose saved model left the
  // registry — ModelSelector no longer commits one, and save requires a model_id.
  // Effect, not render-phase seeding: onChange writes parent-owned state.
  // Never reseed an existing cloud automation: the VPS model registry can lag
  // the local one, and a silent swap here would persist the wrong model on save.
  useEffect(() => {
    if (isEditing && form.onCloud) return;
    if (models.length > 0 && !models.some((m) => m.model_id === form.model_id)) {
      onChange('model_id', models[0].model_id);
    }
  }, [models, form.model_id, form.onCloud, isEditing, onChange]);

  // Same for the workspace — also re-seeds when toggling local/cloud, since the
  // selected workspace only exists on one backend. Unlike the model effect this
  // needs no cloud-edit guard: workspaces are queried from the owning backend,
  // so a missing id means the workspace was deleted, not a registry skew.
  useEffect(() => {
    if (workspaces.length > 0 && !workspaces.some((w) => w.id === form.workspace_id)) {
      onChange('workspace_id', workspaces[0].id);
    }
  }, [workspaces, form.workspace_id, onChange]);

  const selectedModel = models.find((m) => m.model_id === form.model_id);
  const agentKind = selectedModel?.agent_kind ?? 'claude';

  const permissionModes = MODES_BY_AGENT[agentKind];
  const selectedPermissionOption = getPermissionModeOption(form.permission_mode, agentKind);
  const thinkingModes = getThinkingModesForAgent(agentKind, form.model_id);
  const selectedThinkingOption = getThinkingModeOption(
    form.thinking_mode,
    agentKind,
    form.model_id,
  );

  const { schedule } = form;
  const setSchedule = (patch: Partial<ScheduleForm>) =>
    onChange('schedule', { ...schedule, ...patch });
  const cronPreview = buildCronExpression(schedule);

  const canSave =
    !!form.name.trim() &&
    !!form.prompt.trim() &&
    !!form.model_id &&
    !!form.workspace_id &&
    (schedule.frequency !== 'custom' || !!schedule.cron.trim());

  return (
    <BaseModal isOpen={isOpen} onClose={onClose} size="sm" className="overflow-visible">
      <div className="p-5">
        <div className="mb-5 flex items-center gap-2.5">
          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-surface-tertiary dark:bg-surface-dark-tertiary">
            <Clock className="h-4 w-4 text-text-tertiary dark:text-text-dark-tertiary" />
          </div>
          <h3 className="text-sm font-medium text-text-primary dark:text-text-dark-primary">
            {isEditing ? 'Edit automation' : 'Add automation'}
          </h3>
        </div>

        <DialogError error={error} className="mb-4" />

        <div className="space-y-4">
          <div>
            <Label className="mb-1.5 text-xs text-text-secondary dark:text-text-dark-secondary">
              Name
            </Label>
            <Input
              value={form.name}
              onChange={(e) => onChange('name', e.target.value)}
              placeholder="Check Gmail"
              className="text-xs"
            />
          </div>

          <div>
            <Label className="mb-1.5 text-xs text-text-secondary dark:text-text-dark-secondary">
              Workspace
            </Label>
            <div className="flex items-center gap-2">
              {cloudConnected && (
                <ToggleDropdown
                  options={RUN_LOCATION_OPTIONS}
                  value={form.onCloud}
                  onSelect={(enabled) => onChange('onCloud', enabled)}
                  width="8rem"
                  // An automation is stored on the backend that runs it, so the
                  // location can't move after creation.
                  disabled={isEditing}
                />
              )}
              <Select
                value={form.workspace_id}
                onChange={(e) => onChange('workspace_id', e.target.value)}
                className="h-8 bg-surface-secondary px-3 py-1.5 text-xs text-text-primary dark:bg-surface-dark-secondary dark:text-text-dark-primary"
              >
                {workspaces.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </Select>
            </div>
            {workspaces.length === 0 && (
              <p className="mt-1 text-2xs text-text-quaternary dark:text-text-dark-quaternary">
                No {form.onCloud ? 'cloud' : 'local'} workspaces available yet.
              </p>
            )}
          </div>

          <div>
            <Label className="mb-1.5 text-xs text-text-secondary dark:text-text-dark-secondary">
              Model
            </Label>
            <ModelSelector
              selectedModelId={form.model_id}
              onModelChange={(modelId) => onChange('model_id', modelId)}
              dropdownPosition="bottom"
              compact={false}
            />
          </div>

          <div>
            <Label className="mb-1.5 text-xs text-text-secondary dark:text-text-dark-secondary">
              Persona
            </Label>
            <Select
              value={form.persona_name}
              onChange={(e) => onChange('persona_name', e.target.value)}
              className="h-8 bg-surface-secondary px-3 py-1.5 text-xs text-text-primary dark:bg-surface-dark-secondary dark:text-text-dark-primary"
            >
              <option value={DEFAULT_PERSONA}>Default</option>
              {personas.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.name}
                </option>
              ))}
            </Select>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {selectedThinkingOption && (
              <Dropdown
                value={selectedThinkingOption}
                items={thinkingModes}
                getItemKey={(m) => m.value}
                getItemLabel={(m) => m.label}
                onSelect={(m) => onChange('thinking_mode', m.value)}
                leftIcon={Brain}
                dropdownPosition="bottom"
              />
            )}
            <Dropdown
              value={selectedPermissionOption}
              items={permissionModes}
              getItemKey={(m) => m.value}
              getItemLabel={(m) => m.label}
              onSelect={(m) => onChange('permission_mode', m.value)}
              leftIcon={Shield}
              dropdownPosition="bottom"
            />
            <ToggleDropdown
              options={WORKTREE_OPTIONS}
              value={form.worktree}
              onSelect={(enabled) => onChange('worktree', enabled)}
              icon={GitFork}
              width="9rem"
            />
            {agentKind === 'codex' && (
              <label className="flex items-center gap-1.5 text-2xs text-text-tertiary dark:text-text-dark-tertiary">
                <Switch
                  size="sm"
                  checked={form.plan_mode}
                  onCheckedChange={(enabled) => onChange('plan_mode', enabled)}
                  aria-label="Plan mode"
                />
                Plan mode
              </label>
            )}
          </div>

          <div>
            <Label className="mb-1.5 text-xs text-text-secondary dark:text-text-dark-secondary">
              Schedule
            </Label>
            <div className="flex flex-wrap items-center gap-2">
              {/* Width on a wrapper, not the Select — its chevron is positioned
                  against the primitive's own w-full container */}
              <div className="w-36">
                <Select
                  value={schedule.frequency}
                  onChange={(e) => setSchedule({ frequency: e.target.value as ScheduleFrequency })}
                  className="h-8 bg-surface-secondary px-3 py-1.5 text-xs text-text-primary dark:bg-surface-dark-secondary dark:text-text-dark-primary"
                >
                  <option value="hourly">Hourly interval</option>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                  <option value="custom">Custom (cron)</option>
                </Select>
              </div>
              {schedule.frequency === 'hourly' && (
                <div className="flex items-center gap-1.5 text-2xs text-text-tertiary dark:text-text-dark-tertiary">
                  every
                  <Input
                    type="number"
                    min={1}
                    max={23}
                    value={schedule.everyHours}
                    onChange={(e) =>
                      // Cron's hour field only spans 0-23 — a */N step ≥ 24 silently
                      // collapses to "daily at midnight", so clamp below that.
                      setSchedule({
                        everyHours: Math.min(23, Math.max(1, Number(e.target.value) || 1)),
                      })
                    }
                    className="h-8 w-16 text-xs"
                  />
                  hours
                </div>
              )}
              {schedule.frequency === 'weekly' && (
                <div className="w-32">
                  <Select
                    value={schedule.dayOfWeek}
                    onChange={(e) => setSchedule({ dayOfWeek: Number(e.target.value) })}
                    className="h-8 bg-surface-secondary px-3 py-1.5 text-xs text-text-primary dark:bg-surface-dark-secondary dark:text-text-dark-primary"
                  >
                    {WEEKDAY_LABELS.map((label, day) => (
                      <option key={label} value={day}>
                        {label}
                      </option>
                    ))}
                  </Select>
                </div>
              )}
              {schedule.frequency === 'monthly' && (
                <div className="flex items-center gap-1.5 text-2xs text-text-tertiary dark:text-text-dark-tertiary">
                  day
                  <Input
                    type="number"
                    min={1}
                    max={31}
                    value={schedule.dayOfMonth}
                    onChange={(e) => setSchedule({ dayOfMonth: Number(e.target.value) || 1 })}
                    className="h-8 w-16 text-xs"
                  />
                </div>
              )}
              {(schedule.frequency === 'daily' ||
                schedule.frequency === 'weekly' ||
                schedule.frequency === 'monthly') && (
                <div className="flex items-center gap-1.5 text-2xs text-text-tertiary dark:text-text-dark-tertiary">
                  at
                  <Input
                    type="time"
                    value={schedule.time}
                    onChange={(e) => setSchedule({ time: e.target.value })}
                    className="h-8 w-28 text-xs"
                  />
                </div>
              )}
              {schedule.frequency === 'custom' && (
                <Input
                  value={schedule.cron}
                  onChange={(e) => setSchedule({ cron: e.target.value })}
                  placeholder="0 */6 * * *"
                  className="h-8 w-40 font-mono text-xs"
                />
              )}
            </div>
            <p className="mt-1 text-2xs text-text-quaternary dark:text-text-dark-quaternary">
              {describeCron(cronPreview)} · {form.timezone}
            </p>
          </div>

          <div>
            <Label className="mb-1.5 text-xs text-text-secondary dark:text-text-dark-secondary">
              Prompt
            </Label>
            <Textarea
              value={form.prompt}
              onChange={(e) => onChange('prompt', e.target.value)}
              placeholder="Check my Gmail inbox and summarize anything that needs a reply."
              className="min-h-[120px] text-xs"
              rows={5}
            />
            <p className="mt-1 text-2xs text-text-quaternary dark:text-text-dark-quaternary">
              Each run starts a new chat in the selected workspace with this prompt.
            </p>
          </div>
        </div>

        <DialogFooter
          onCancel={onClose}
          onSave={onSubmit}
          saveLabel={isEditing ? 'Update' : 'Add automation'}
          disabled={!canSave || isSaving}
        />
      </div>
    </BaseModal>
  );
};
