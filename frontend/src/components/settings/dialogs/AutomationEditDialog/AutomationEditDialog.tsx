import { useEffect } from 'react';
import type { Persona } from '@/types/user.types';
import type { AutomationForm } from '@/types/automation.types';
import { Input } from '@/components/ui/primitives/Input/Input';
import { Label } from '@/components/ui/primitives/Label/Label';
import { Select } from '@/components/ui/primitives/Select/Select';
import { Textarea } from '@/components/ui/primitives/Textarea/Textarea';
import { FieldMessage } from '@/components/ui/primitives/FieldMessage/FieldMessage';
import { BaseModal } from '@/components/ui/shared/BaseModal/BaseModal';
import { ModalHeader } from '@/components/ui/shared/ModalHeader/ModalHeader';
import { DialogFooter } from '@/components/ui/shared/DialogFooter/DialogFooter';
import { DialogError } from '@/components/ui/shared/DialogError/DialogError';
import { ModelSelector } from '@/components/chat/model-selector/ModelSelector';
import { ThreadSettings } from '@/components/layout/NewThreadModal/ThreadSettings';
import { useModelsQuery } from '@/hooks/queries/useModelQueries';
import { useWorkspacesList } from '@/hooks/queries/useWorkspaceQueries';
import {
  groupMemberDraft,
  newGroupMember,
  patchGroupMember,
  resolveMemberNames,
  type GroupMember,
} from '@/components/channels/memberDraft';
import { LOCAL_MACHINE_ID } from '@/types/machine.types';
import { machineName } from '@/store/machineStore';
import { isChannelForm } from '@/utils/automationForm';
import {
  buildCronExpression,
  describeCron,
  WEEKDAY_LABELS,
  type ScheduleForm,
  type ScheduleFrequency,
} from '@/utils/automationSchedule';
import styles from './AutomationEditDialog.module.scss';

interface AutomationEditDialogProps {
  isOpen: boolean;
  isEditing: boolean;
  form: AutomationForm;
  personas: Persona[];
  personasLoaded: boolean;
  machineOptions: { id: string; name: string }[];
  error: string | null;
  isSaving: boolean;
  onClose: () => void;
  onSubmit: () => void;
  onChange: <K extends keyof AutomationForm>(field: K, value: AutomationForm[K]) => void;
}

export function AutomationEditDialog({
  isOpen,
  isEditing,
  form,
  personas,
  personasLoaded,
  machineOptions,
  error,
  isSaving,
  onClose,
  onSubmit,
  onChange,
}: AutomationEditDialogProps) {
  const { data: models = [] } = useModelsQuery({ machineId: form.machineId });
  const isLocal = form.machineId === LOCAL_MACHINE_ID;
  const workspaces = useWorkspacesList({ machineId: form.machineId });
  const machineOffline = !machineOptions.some((machine) => machine.id === form.machineId);
  const isChannel = isChannelForm(form);
  const [firstAgent] = form.agents;
  const nameError = isChannel
    ? resolveMemberNames(
        form.agents.map((agent) => groupMemberDraft(agent, form.shared)),
        models,
      ).find((memberName) => memberName.error)
    : undefined;
  const machines = machineOffline
    ? [...machineOptions, { id: form.machineId, name: `${machineName(form.machineId)} (offline)` }]
    : machineOptions;

  // Seed a chat's model when missing/left registry. Effect (onChange writes parent state).
  // Never reseed remote edits — registry lag would silently swap the model on save.
  useEffect(() => {
    if (isChannel || (isEditing && !isLocal)) return;
    if (models.length > 0 && !models.some((m) => m.model_id === firstAgent.modelId)) {
      onChange('agents', [patchGroupMember(firstAgent, { modelId: models[0].model_id })]);
    }
  }, [models, firstAgent, isChannel, isLocal, isEditing, onChange]);

  // Workspace only exists on one machine; re-seed on machine change. No remote-edit
  // guard — workspaces come from the owning machine, so missing id means deleted.
  useEffect(() => {
    if (workspaces.length > 0 && !workspaces.some((w) => w.id === form.workspace_id)) {
      onChange('workspace_id', workspaces[0].id);
    }
  }, [workspaces, form.workspace_id, onChange]);

  const setAgents = (agents: GroupMember[]) => {
    onChange('agents', agents);
    if (agents.length > 1) onChange('singleMemberChannel', false);
  };
  const agentsHint =
    form.agents.length > 1
      ? `Each run starts a new group thread with these ${form.agents.length} agents.`
      : form.singleMemberChannel
        ? 'Each run starts a new group thread with this agent.'
        : 'Each run starts a new thread with this agent. Add more for a group thread.';

  const { schedule } = form;
  const setSchedule = (patch: Partial<ScheduleForm>) =>
    onChange('schedule', { ...schedule, ...patch });
  const cronPreview = buildCronExpression(schedule);

  const canSave =
    !!form.name.trim() &&
    !!form.prompt.trim() &&
    !!firstAgent.modelId &&
    !!form.workspace_id &&
    (schedule.frequency !== 'custom' || !!schedule.cron.trim()) &&
    !nameError &&
    !machineOffline &&
    personasLoaded;

  return (
    <BaseModal isOpen={isOpen} onClose={onClose} size="sm" className={styles.dialog}>
      <ModalHeader title={isEditing ? 'Edit automation' : 'Add automation'} onClose={onClose} />
      <div className={styles.body}>
        <DialogError
          error={error ?? (machineOffline ? "This automation's machine is offline" : null)}
          className={styles.error}
        />

        <div className={styles.fields}>
          <div>
            <Label className={styles.label}>Name</Label>
            <Input
              value={form.name}
              onChange={(e) => onChange('name', e.target.value)}
              placeholder="Check Gmail"
              className={styles.input}
            />
          </div>

          <div>
            <Label className={styles.label}>Workspace</Label>
            <div className={styles.row}>
              {machines.length > 1 && (
                <Select
                  value={form.machineId}
                  onChange={(e) => {
                    onChange('machineId', e.target.value);
                    onChange('workspace_id', '');
                  }}
                  className={styles.select}
                  aria-label="Machine"
                  // An automation is stored on the machine that runs it, so the
                  // location can't move after creation.
                  disabled={isEditing}
                >
                  {machines.map((machine) => (
                    <option
                      key={machine.id}
                      value={machine.id}
                      disabled={machineOffline && machine.id === form.machineId}
                    >
                      {machine.name}
                    </option>
                  ))}
                </Select>
              )}
              <Select
                value={form.workspace_id}
                onChange={(e) => onChange('workspace_id', e.target.value)}
                className={styles.select}
              >
                {workspaces.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </Select>
            </div>
            {workspaces.length === 0 && (
              <p className={styles.hint}>No workspaces available on this machine yet.</p>
            )}
          </div>

          <div>
            <Label className={styles.label}>Agents</Label>
            <div className={styles.agents}>
              <ModelSelector
                machineId={form.machineId}
                selectedModelId={firstAgent.modelId}
                onModelChange={(modelId) => setAgents([patchGroupMember(firstAgent, { modelId })])}
                dropdownPosition="bottom"
                compact={false}
                variant="field"
                agents={{
                  modelIds: form.agents.map((agent) => agent.modelId),
                  onAdd: (modelId) => setAgents([...form.agents, newGroupMember(modelId)]),
                  onRemove: (modelId) => {
                    const index = form.agents.map((agent) => agent.modelId).lastIndexOf(modelId);
                    if (form.agents.length > 1)
                      setAgents(form.agents.filter((_, i) => i !== index));
                  },
                }}
              />
              <ThreadSettings
                machineId={form.machineId}
                members={form.agents}
                shared={form.shared}
                personas={personas}
                disabled={false}
                variant="field"
                onChange={setAgents}
                onSharedChange={(patch) => onChange('shared', { ...form.shared, ...patch })}
              />
            </div>
            {nameError ? (
              <FieldMessage variant="error" className={styles.hint}>
                {nameError.name}: {nameError.error}
              </FieldMessage>
            ) : (
              <p className={styles.hint}>{agentsHint}</p>
            )}
          </div>

          <div>
            <Label className={styles.label}>Worktree</Label>
            <div className={styles['select-w36']}>
              <Select
                value={form.worktree ? 'on' : 'off'}
                onChange={(e) => onChange('worktree', e.target.value === 'on')}
                className={styles.select}
              >
                <option value="off">No worktree</option>
                <option value="on">Worktree</option>
              </Select>
            </div>
          </div>

          <div>
            <Label className={styles.label}>Schedule</Label>
            <div className={styles['control-row']}>
              {/* Width on a wrapper, not the Select — its chevron is positioned
                  against the primitive's own w-full container */}
              <div className={styles['select-w36']}>
                <Select
                  value={schedule.frequency}
                  onChange={(e) => setSchedule({ frequency: e.target.value as ScheduleFrequency })}
                  className={styles.select}
                >
                  <option value="hourly">Hourly interval</option>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                  <option value="custom">Custom (cron)</option>
                </Select>
              </div>
              {schedule.frequency === 'hourly' && (
                <div className={styles['inline-field']}>
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
                    className={styles['num-input']}
                  />
                  hours
                </div>
              )}
              {schedule.frequency === 'weekly' && (
                <div className={styles['select-w32']}>
                  <Select
                    value={schedule.dayOfWeek}
                    onChange={(e) => setSchedule({ dayOfWeek: Number(e.target.value) })}
                    className={styles.select}
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
                <div className={styles['inline-field']}>
                  day
                  <Input
                    type="number"
                    min={1}
                    max={31}
                    value={schedule.dayOfMonth}
                    onChange={(e) => setSchedule({ dayOfMonth: Number(e.target.value) || 1 })}
                    className={styles['num-input']}
                  />
                </div>
              )}
              {(schedule.frequency === 'daily' ||
                schedule.frequency === 'weekly' ||
                schedule.frequency === 'monthly') && (
                <div className={styles['inline-field']}>
                  at
                  <Input
                    type="time"
                    value={schedule.time}
                    onChange={(e) => setSchedule({ time: e.target.value })}
                    className={styles['time-input']}
                  />
                </div>
              )}
              {schedule.frequency === 'custom' && (
                <Input
                  value={schedule.cron}
                  onChange={(e) => setSchedule({ cron: e.target.value })}
                  placeholder="0 */6 * * *"
                  className={styles['cron-input']}
                />
              )}
            </div>
            <p className={styles.hint}>
              {describeCron(cronPreview)} · {form.timezone}
            </p>
          </div>

          <div>
            <Label className={styles.label}>Prompt</Label>
            <Textarea
              value={form.prompt}
              onChange={(e) => onChange('prompt', e.target.value)}
              placeholder="Check my Gmail inbox and summarize anything that needs a reply."
              className={styles['prompt-textarea']}
              rows={5}
            />
          </div>
        </div>
      </div>
      <DialogFooter
        onCancel={onClose}
        onSave={onSubmit}
        saveLabel={isEditing ? 'Update' : 'Add automation'}
        disabled={!canSave || isSaving}
      />
    </BaseModal>
  );
}
