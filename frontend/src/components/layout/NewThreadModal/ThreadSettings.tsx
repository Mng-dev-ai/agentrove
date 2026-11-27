import { useRef, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { Check, ChevronDown, ChevronLeft, ChevronRight, Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button/Button';
import { FieldMessage } from '@/components/ui/primitives/FieldMessage/FieldMessage';
import { ProviderIcon } from '@/components/ui/icons/ProviderIcon';
import { useDropdown } from '@/hooks/useDropdown';
import { useIsMobile } from '@/hooks/useIsMobile';
import { usePanelFit, usePanelInlineShift } from '@/hooks/usePanelFit';
import { useModelsQuery } from '@/hooks/queries/useModelQueries';
import { DEFAULT_PERSONA } from '@/store/chatSettingsStore';
import {
  getThinkingModeOption,
  getThinkingModesForAgent,
} from '@/components/chat/thinking-mode-selector/thinkingModes';
import {
  MODES_BY_AGENT,
  getPermissionModeOption,
} from '@/components/chat/permission-mode-selector/permissionModes';
import { FAST_MODE_OPTIONS } from '@/components/chat/fast-mode-selector/fastModes';
import {
  getPersonaOption,
  getPersonaOptions,
} from '@/components/chat/persona-selector/personaOptions';
import {
  MEMBER_NAME_MAX_LENGTH,
  clearMemberOverrides,
  groupMemberDraft,
  mixedMemberSettings,
  patchGroupMember,
  resolveMember,
  resolveMemberNames,
  settingsModel,
  withSupportedOverrides,
  type GroupMember,
  type MemberDraft,
  type MemberSetting,
  type SharedMemberSettings,
} from '@/components/channels/memberDraft';
import { supportsFastMode, supportsPersona, type Model } from '@/types/chat.types';
import type { Persona } from '@/types/user.types';
import styles from './ThreadSettings.module.scss';

interface SettingRowProps<T extends string> {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T;
  valueLabel: string;
  onPick: (value: T) => void;
  // An agent's value that follows the shared setting reads muted
  isInherited?: boolean;
  isMixed?: boolean;
  // Offered while an agent overrides the setting: picking it clears the override
  shared?: { label: string; onPick: () => void };
}

// Label left, value right; the row opens a small menu of its options
function SettingRow<T extends string>({
  label,
  options,
  value,
  valueLabel,
  onPick,
  isInherited = false,
  isMixed = false,
  shared,
}: SettingRowProps<T>) {
  const { isOpen, dropdownRef, setIsOpen } = useDropdown();
  const menuRef = useRef<HTMLDivElement>(null);
  const fit = usePanelFit(dropdownRef, menuRef, isOpen);
  const pick = (apply: () => void) => {
    apply();
    setIsOpen(false);
  };
  return (
    <div ref={dropdownRef} className={styles.setting}>
      <Button
        type="button"
        variant="unstyled"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={() => setIsOpen(!isOpen)}
        className={styles.row}
      >
        <span className={styles['row-label']}>{label}</span>
        <span className={clsx(styles['row-value'], isInherited && styles['row-value--inherited'])}>
          {valueLabel}
          {isMixed && <span className={styles['row-mixed']}> · mixed</span>}
        </span>
        <ChevronDown className={styles['row-chevron']} />
      </Button>
      {isOpen && (
        <div
          ref={menuRef}
          role="menu"
          aria-label={label}
          style={{ maxHeight: fit?.maxHeight }}
          className={clsx(styles.menu, fit?.side === 'top' && styles['menu--top'])}
        >
          {shared && (
            <>
              <Button
                type="button"
                variant="unstyled"
                role="menuitem"
                onClick={() => pick(shared.onPick)}
                className={styles.option}
              >
                <span>Same as all agents</span>
                <span className={styles['option-meta']}>{shared.label}</span>
              </Button>
              <div role="separator" className={styles.divider} />
            </>
          )}
          {options.map((option) => (
            <Button
              key={option.value}
              type="button"
              variant="unstyled"
              role="menuitemradio"
              aria-checked={option.value === value}
              onClick={() => pick(() => onPick(option.value))}
              className={styles.option}
            >
              <span>{option.label}</span>
              {option.value === value && <Check className={styles['option-check']} />}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

const permissionOptions = (agentKind: Model['agent_kind']) => MODES_BY_AGENT[agentKind];

interface ThreadSettingsProps {
  machineId: string;
  members: GroupMember[];
  // The members are sent as a channel's, which resolves an unlisted model; a chat keeps it
  channel: boolean;
  shared: SharedMemberSettings;
  personas: Persona[];
  disabled: boolean;
  variant: 'pill' | 'field';
  onChange: (members: GroupMember[]) => void;
  onSharedChange: (patch: Partial<SharedMemberSettings>) => void;
  // Shown for one agent when given; channel members take no fast mode
  fastMode?: { value: boolean; onChange: (enabled: boolean) => void };
}

// The settings control of the New thread modal and the automation dialog. One agent gets a
// plain list; a group gets a side list of "All agents" (the shared settings) and each agent
// with its own overrides.
export function ThreadSettings({
  machineId,
  members: givenMembers,
  channel,
  shared,
  personas,
  disabled,
  variant,
  onChange,
  onSharedChange,
  fastMode,
}: ThreadSettingsProps) {
  const { data: models = [] } = useModelsQuery({ machineId });
  const isMobile = useIsMobile();
  const { isOpen, dropdownRef, setIsOpen } = useDropdown();
  const panelRef = useRef<HTMLDivElement>(null);
  const fit = usePanelFit(dropdownRef, panelRef, isOpen);
  const panelTransform = usePanelInlineShift(panelRef, isOpen && !disabled);
  // null is "All agents"
  const [entryKey, setEntryKey] = useState<string | null>(null);
  const [drilledIn, setDrilledIn] = useState(false);
  if (!isOpen && (entryKey || drilledIn)) {
    setEntryKey(null);
    setDrilledIn(false);
  }

  const members = withSupportedOverrides(givenMembers, models);
  const drafts = members.map((member) => groupMemberDraft(member, shared));
  const names = resolveMemberNames(drafts, models);
  const isGroup = members.length > 1;
  // A lone agent runs on the shared settings, so nothing reads as mixed
  const mixed = mixedMemberSettings(isGroup ? members : [], shared);
  const personaOptions = getPersonaOptions(personas);

  // Shared settings follow the first agent that supports each one
  const memberModels = members.map((member) => settingsModel(member.modelId, models, channel));
  const thinkingModel = memberModels.find(
    ({ agentKind, model }) => getThinkingModesForAgent(agentKind, model).length > 0,
  );
  const personaModel =
    personas.length > 0
      ? memberModels.find(({ agentKind, model }) => supportsPersona(model, agentKind))
      : undefined;
  const first = memberModels[0];
  const sharedEffort =
    thinkingModel &&
    getThinkingModeOption(shared.thinkingMode, thinkingModel.agentKind, thinkingModel.model);
  const sharedPersona = getPersonaOption(shared.persona, personaOptions);

  // Clearing first, since the modal's store ignores a pick that equals the current value
  const setShared = (setting: MemberSetting, patch: Partial<SharedMemberSettings>) => {
    onChange(clearMemberOverrides(members, setting));
    onSharedChange(patch);
  };

  const effortPart = sharedEffort && (mixed.thinkingMode ? 'Mixed' : sharedEffort.label);
  const personaPart =
    personaModel &&
    (mixed.persona
      ? 'Mixed'
      : sharedPersona.value !== DEFAULT_PERSONA
        ? sharedPersona.label
        : null);
  const sharedSummary = [effortPart, personaPart].filter(Boolean).join(' · ');

  const sharedRows = (
    <>
      {thinkingModel && sharedEffort && (
        <SettingRow
          label="Effort"
          options={getThinkingModesForAgent(thinkingModel.agentKind, thinkingModel.model)}
          value={sharedEffort.value}
          valueLabel={sharedEffort.label}
          isMixed={mixed.thinkingMode}
          onPick={(value) => setShared('thinkingMode', { thinkingMode: value })}
        />
      )}
      {personaModel && (
        <SettingRow
          label="Persona"
          options={personaOptions}
          value={sharedPersona.value}
          valueLabel={sharedPersona.label}
          isMixed={mixed.persona}
          onPick={(value) => setShared('persona', { persona: value })}
        />
      )}
      {first && (
        <SettingRow
          label="Permission"
          options={permissionOptions(first.agentKind)}
          value={getPermissionModeOption(shared.permissionMode, first.agentKind).value}
          valueLabel={getPermissionModeOption(shared.permissionMode, first.agentKind).label}
          isMixed={mixed.permissionMode}
          onPick={(value) => setShared('permissionMode', { permissionMode: value })}
        />
      )}
      {fastMode && !isGroup && first && supportsFastMode(first.model, first.agentKind) && (
        <SettingRow
          label="Fast mode"
          options={FAST_MODE_OPTIONS.map((mode) => ({
            value: String(mode.value),
            label: mode.label,
          }))}
          value={String(fastMode.value)}
          valueLabel={FAST_MODE_OPTIONS[fastMode.value ? 1 : 0].label}
          onPick={(value) => fastMode.onChange(value === 'true')}
        />
      )}
    </>
  );

  const memberIndex = members.findIndex((member) => member.key === entryKey);
  const member = members[memberIndex];

  const overrideSummary = (draft: MemberDraft, overrides: GroupMember['overrides']) => {
    const { agentKind, model } = resolveMember(draft, models);
    return [
      overrides.thinkingMode !== undefined &&
        getThinkingModeOption(overrides.thinkingMode, agentKind, model)?.label,
      overrides.persona !== undefined && getPersonaOption(overrides.persona, personaOptions).label,
      overrides.permissionMode !== undefined &&
        getPermissionModeOption(overrides.permissionMode, agentKind).label,
    ]
      .filter(Boolean)
      .join(' · ');
  };

  const memberRows = (index: number) => {
    const current = members[index];
    const draft = drafts[index];
    const name = names[index];
    const {
      agentKind,
      model,
      hasThinking,
      supportsPersona: hasPersona,
    } = resolveMember(draft, models);
    const patch = (change: Partial<MemberDraft>) =>
      onChange(members.map((m) => (m.key === current.key ? patchGroupMember(m, change) : m)));
    const clear = (setting: MemberSetting) => {
      const overrides = { ...current.overrides };
      delete overrides[setting];
      onChange(members.map((m) => (m.key === current.key ? { ...m, overrides } : m)));
    };
    const effort = getThinkingModeOption(draft.thinkingMode, agentKind, model);
    const persona = getPersonaOption(draft.persona, personaOptions);
    const permission = getPermissionModeOption(draft.permissionMode, agentKind);
    const nameInputId = `thread-member-name-${current.key}`;
    return (
      <>
        <div className={styles.setting}>
          <label htmlFor={nameInputId} className={styles.row}>
            <span className={styles['row-label']}>Name</span>
            <input
              id={nameInputId}
              value={draft.customName ?? name.name}
              onChange={(e) => patch({ customName: e.target.value })}
              placeholder={name.name}
              maxLength={MEMBER_NAME_MAX_LENGTH}
              aria-invalid={!!name.error}
              className={styles['name-input']}
            />
          </label>
          <FieldMessage variant="error" className={styles['name-error']}>
            {name.error}
          </FieldMessage>
        </div>
        {hasThinking && effort && (
          <SettingRow
            label="Effort"
            options={getThinkingModesForAgent(agentKind, model)}
            value={effort.value}
            valueLabel={effort.label}
            isInherited={current.overrides.thinkingMode === undefined}
            shared={
              current.overrides.thinkingMode !== undefined
                ? {
                    label:
                      getThinkingModeOption(shared.thinkingMode, agentKind, model)?.label ?? '',
                    onPick: () => clear('thinkingMode'),
                  }
                : undefined
            }
            onPick={(thinkingMode) => patch({ thinkingMode })}
          />
        )}
        {hasPersona && personas.length > 0 && (
          <SettingRow
            label="Persona"
            options={personaOptions}
            value={persona.value}
            valueLabel={persona.label}
            isInherited={current.overrides.persona === undefined}
            shared={
              current.overrides.persona !== undefined
                ? { label: sharedPersona.label, onPick: () => clear('persona') }
                : undefined
            }
            onPick={(value) => patch({ persona: value })}
          />
        )}
        <SettingRow
          label="Permission"
          options={permissionOptions(agentKind)}
          value={permission.value}
          valueLabel={permission.label}
          isInherited={current.overrides.permissionMode === undefined}
          shared={
            current.overrides.permissionMode !== undefined
              ? {
                  label: getPermissionModeOption(shared.permissionMode, agentKind).label,
                  onPick: () => clear('permissionMode'),
                }
              : undefined
          }
          onPick={(permissionMode) => patch({ permissionMode })}
        />
      </>
    );
  };

  const hasOverrides = !!member && Object.keys(member.overrides).length > 0;
  const detail = (
    <div className={styles.detail}>
      <div className={styles.heading}>
        <span className={styles['heading-text']}>
          {member ? names[memberIndex].name : `Applies to all ${members.length} agents`}
        </span>
        {hasOverrides && (
          <Button
            type="button"
            variant="unstyled"
            onClick={() =>
              onChange(members.map((m) => (m.key === member.key ? { ...m, overrides: {} } : m)))
            }
            className={styles.reset}
          >
            Reset
          </Button>
        )}
      </div>
      {member ? memberRows(memberIndex) : sharedRows}
    </div>
  );

  const openEntry = (key: string | null) => {
    setEntryKey(key);
    if (isMobile) setDrilledIn(true);
  };

  const entries = (
    <div className={styles.entries}>
      <Button
        type="button"
        variant="unstyled"
        aria-current={!member}
        onClick={() => openEntry(null)}
        className={clsx(styles.entry, !member && !isMobile && styles['entry--active'])}
      >
        <span className={styles['entry-name']}>All agents</span>
        {sharedSummary && <span className={styles['entry-meta']}>{sharedSummary}</span>}
        {isMobile && <ChevronRight className={styles['entry-chevron']} />}
      </Button>
      <p className={styles['entries-label']}>Overrides</p>
      {members.map((m, index) => {
        const isActive = m.key === member?.key;
        return (
          <Button
            key={m.key}
            type="button"
            variant="unstyled"
            aria-current={isActive}
            onClick={() => openEntry(m.key)}
            className={clsx(styles.entry, isActive && !isMobile && styles['entry--active'])}
          >
            <span className={styles['entry-name']}>
              <ProviderIcon
                agentKind={memberModels[index].agentKind}
                className={styles['entry-icon']}
              />
              <span className={styles['entry-text']}>{names[index].name}</span>
            </span>
            <span className={styles['entry-meta']}>
              {overrideSummary(drafts[index], m.overrides) || 'Same as all'}
            </span>
            {isMobile && <ChevronRight className={styles['entry-chevron']} />}
          </Button>
        );
      })}
    </div>
  );

  let body: ReactNode;
  if (!isGroup) body = <div className={styles.single}>{sharedRows}</div>;
  else if (!isMobile)
    body = (
      <div className={styles.split}>
        {entries}
        {detail}
      </div>
    );
  else if (drilledIn)
    body = (
      <>
        <Button
          type="button"
          variant="unstyled"
          onClick={() => setDrilledIn(false)}
          className={styles.back}
        >
          <ChevronLeft className={styles['back-icon']} />
          Settings
        </Button>
        {detail}
      </>
    );
  else body = entries;

  return (
    <div ref={dropdownRef} className={styles[`picker--${variant}`]}>
      <Button
        type="button"
        variant="unstyled"
        disabled={disabled}
        onClick={() => setIsOpen(!isOpen)}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-label={`Settings${sharedSummary ? `: ${sharedSummary}` : ''}`}
        className={styles[`trigger--${variant}`]}
      >
        <Settings2 aria-hidden />
        {variant === 'field' ? (
          <>
            <span className={styles['trigger-label']}>{sharedSummary || 'Settings'}</span>
            <ChevronDown aria-hidden className={styles['trigger-chevron']} />
          </>
        ) : (
          sharedSummary && <span className={styles['trigger-label']}>{sharedSummary}</span>
        )}
      </Button>
      {isOpen && !disabled && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Settings"
          style={{ maxHeight: fit?.maxHeight, transform: panelTransform }}
          className={clsx(
            styles.panel,
            fit?.side === 'top' && styles['panel--top'],
            isGroup && !isMobile && styles['panel--split'],
            variant === 'field' && styles['panel--field'],
          )}
        >
          {body}
        </div>
      )}
    </div>
  );
}
