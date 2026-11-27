import { Fragment, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import clsx from 'clsx';
import { Box, Check, ChevronLeft, ChevronRight, Plus, Search, Star } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button/Button';
import { Input } from '@/components/ui/primitives/Input/Input';
import { FieldMessage } from '@/components/ui/primitives/FieldMessage/FieldMessage';
import { ProviderIcon } from '@/components/ui/icons/ProviderIcon';
import { ProviderIconStack } from '@/components/ui/icons/ProviderIconStack';
import { useDropdown } from '@/hooks/useDropdown';
import { useIsMobile } from '@/hooks/useIsMobile';
import { usePanelFit, usePanelInlineShift } from '@/hooks/usePanelFit';
import { useModelsQuery } from '@/hooks/queries/useModelQueries';
import { useModelStore } from '@/store/modelStore';
import {
  useChatSettingsStore,
  DEFAULT_CHAT_SETTINGS_KEY,
  DEFAULT_FAST_MODE,
} from '@/store/chatSettingsStore';
import { fuzzySearch } from '@/utils/fuzzySearch';
import { formatNumberCompact } from '@/utils/format';
import {
  getThinkingModeOption,
  getThinkingModesForAgent,
} from '@/components/chat/thinking-mode-selector/thinkingModes';
import {
  MODES_BY_AGENT,
  coercePermissionModeForAgent,
} from '@/components/chat/permission-mode-selector/permissionModes';
import { FAST_MODE_OPTIONS } from '@/components/chat/fast-mode-selector/fastModes';
import {
  getPersonaOption,
  getPersonaOptions,
} from '@/components/chat/persona-selector/personaOptions';
import {
  MEMBER_NAME_MAX_LENGTH,
  groupMemberDraft,
  mixedMemberSettings,
  newGroupMember,
  patchGroupMember,
  resolveMember,
  resolveMemberNames,
  type GroupMember,
  type MemberDraft,
  type MemberName,
  type SharedMemberSettings,
} from '@/components/channels/memberDraft';
import { supportsFastMode, supportsPersona, type Model } from '@/types/chat.types';
import type { Persona } from '@/types/user.types';
import { favoritesFirst, listedModels } from './modelOrder';
import styles from './ModelPicker.module.scss';

type SettingKey = 'effort' | 'persona' | 'permission' | 'fast';
type Highlight =
  | { kind: 'model'; modelId: string }
  | { kind: 'member'; key: string }
  | { kind: 'setting'; key: SettingKey };
// What the options section beside the list (a drill-in on phones) shows
type Section = { kind: 'setting'; key: SettingKey } | { kind: 'member'; key: string };

interface Option<T extends string> {
  value: T;
  label: string;
}

interface Entry {
  highlight: Highlight;
  model: Model;
  // Set on a duplicate's own row, nested under its model row
  member?: GroupMember;
}

const entryId = (highlight: Highlight) =>
  highlight.kind === 'model'
    ? `model-picker-${highlight.modelId}`
    : `model-picker-${highlight.kind}-${highlight.key}`;

const sameHighlight = (a: Highlight | null, b: Highlight) => !!a && entryId(a) === entryId(b);

const sameSection = (a: Section | null, b: Section) => !!a && a.kind === b.kind && a.key === b.key;

function OptionList<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly Option<T>[];
  value: T | null;
  onChange: (value: T) => void;
}) {
  return (
    <div className={styles.options}>
      {options.map((option) => (
        <Button
          key={option.value}
          type="button"
          variant="unstyled"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
          className={styles.option}
        >
          {option.label}
          {option.value === value && <Check className={styles['option-check']} />}
        </Button>
      ))}
    </div>
  );
}

interface MemberSectionProps {
  model: Model;
  draft: MemberDraft;
  memberName: MemberName;
  isGroup: boolean;
  hasOverrides: boolean;
  personas: Persona[];
  onChange: (patch: Partial<MemberDraft>) => void;
  onReset: () => void;
  onRemove: () => void;
}

function MemberSection({
  model,
  draft,
  memberName,
  isGroup,
  hasOverrides,
  personas,
  onChange,
  onReset,
  onRemove,
}: MemberSectionProps) {
  const { agentKind, hasThinking, supportsPersona: hasPersona } = resolveMember(draft, [model]);
  const personaOptions = getPersonaOptions(personas);
  const nameInputId = `member-name-${draft.key}`;
  return (
    <>
      <p className={styles['section-title']}>{memberName.name}</p>
      {isGroup && (
        <div className={styles['name-field']}>
          <label htmlFor={nameInputId} className={styles['section-heading']}>
            Name
          </label>
          <Input
            id={nameInputId}
            value={draft.customName ?? memberName.name}
            onChange={(e) => onChange({ customName: e.target.value })}
            placeholder={memberName.name}
            maxLength={MEMBER_NAME_MAX_LENGTH}
            hasError={!!memberName.error}
            className={styles['name-input']}
          />
          <FieldMessage variant="error" className={styles['name-error']}>
            {memberName.error}
          </FieldMessage>
        </div>
      )}
      {hasThinking && (
        <>
          <p className={styles['section-heading']}>Effort</p>
          <OptionList
            options={getThinkingModesForAgent(agentKind, model)}
            value={getThinkingModeOption(draft.thinkingMode, agentKind, model)?.value ?? null}
            onChange={(thinkingMode) => onChange({ thinkingMode })}
          />
        </>
      )}
      {hasPersona && personas.length > 0 && (
        <>
          <p className={styles['section-heading']}>Persona</p>
          <OptionList
            options={personaOptions}
            value={getPersonaOption(draft.persona, personaOptions).value}
            onChange={(persona) => onChange({ persona })}
          />
        </>
      )}
      <p className={styles['section-heading']}>Permission</p>
      <OptionList
        options={MODES_BY_AGENT[agentKind]}
        value={coercePermissionModeForAgent(draft.permissionMode, agentKind)}
        onChange={(permissionMode) => onChange({ permissionMode })}
      />
      <div className={styles['section-actions']}>
        {hasOverrides && (
          <Button type="button" variant="unstyled" onClick={onReset} className={styles.link}>
            Reset to shared
          </Button>
        )}
        <Button
          type="button"
          variant="unstyled"
          onClick={onRemove}
          className={clsx(styles.link, styles['link--danger'])}
        >
          Remove
        </Button>
      </div>
    </>
  );
}

interface ModelPickerProps {
  machineId: string;
  members: GroupMember[];
  shared: SharedMemberSettings;
  personas: Persona[];
  disabled: boolean;
  onChange: (members: GroupMember[]) => void;
}

// The New thread model panel: one ticked model is a chat, several a group thread. A shared
// setting row or a member's chevron opens its options in a section beside the list, where a
// member's own settings override the shared ones. Phones drill into that section instead.
export function ModelPicker({
  machineId,
  members,
  shared,
  personas,
  disabled,
  onChange,
}: ModelPickerProps) {
  const { data: models = [] } = useModelsQuery({ machineId });
  const favoriteModelIds = useModelStore((state) => state.favoriteModelIds);
  const fastMode = useChatSettingsStore(
    (state) => state.fastModeByChat[DEFAULT_CHAT_SETTINGS_KEY] ?? DEFAULT_FAST_MODE,
  );
  const isMobile = useIsMobile();
  const { isOpen, dropdownRef, setIsOpen } = useDropdown();
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const fit = usePanelFit(dropdownRef, panelRef, isOpen);
  const panelTransform = usePanelInlineShift(panelRef, isOpen && !disabled);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState<Highlight | null>(null);
  const [openSection, setOpenSection] = useState<Section | null>(null);
  if (!isOpen && (query || highlight || openSection)) {
    setQuery('');
    setHighlight(null);
    setOpenSection(null);
  }

  const modelById = new Map(models.map((m) => [m.model_id, m]));
  const drafts = members.map((member) => groupMemberDraft(member, shared));
  const names = resolveMemberNames(drafts, models);
  const isGroup = members.length > 1;
  const mixed = isGroup
    ? mixedMemberSettings(members, shared)
    : { thinkingMode: false, persona: false, permissionMode: false };
  const membersOf = (modelId: string) => members.filter((member) => member.modelId === modelId);

  const listed = listedModels(
    models,
    members.map((member) => member.modelId),
    favoriteModelIds,
  );
  const sections: Model[][] = query.trim()
    ? [fuzzySearch(query, listed, { keys: ['name'], limit: 50 })]
    : Object.values(favoritesFirst(listed, favoriteModelIds)).filter((list) => list.length > 0);
  const sectionEntries: Entry[][] = sections.map((section) =>
    section.flatMap((model) => {
      const own = membersOf(model.model_id);
      const modelEntry: Entry = { highlight: { kind: 'model', modelId: model.model_id }, model };
      if (own.length < 2) return [modelEntry];
      return [
        modelEntry,
        ...own.map((member) => ({
          highlight: { kind: 'member' as const, key: member.key },
          model,
          member,
        })),
      ];
    }),
  );
  const entries = sectionEntries.flat();

  // Shared settings follow the first member that supports each one
  const memberModels = members
    .map((member) => modelById.get(member.modelId))
    .filter((m): m is Model => m !== undefined);
  const thinkingModel = memberModels.find(
    (m) => getThinkingModesForAgent(m.agent_kind, m).length > 0,
  );
  const personaModel = memberModels.find((m) => supportsPersona(m, m.agent_kind));
  const first = memberModels[0];
  const effortOption =
    thinkingModel &&
    getThinkingModeOption(shared.thinkingMode, thinkingModel.agent_kind, thinkingModel);
  const personaOptions = getPersonaOptions(personas);
  const settingRows: {
    key: SettingKey;
    label: string;
    value: string;
    options: ReactNode;
  }[] = [];
  if (thinkingModel && effortOption) {
    settingRows.push({
      key: 'effort',
      label: 'Effort',
      value: mixed.thinkingMode ? 'Mixed' : effortOption.label,
      options: (
        <OptionList
          options={getThinkingModesForAgent(thinkingModel.agent_kind, thinkingModel)}
          value={mixed.thinkingMode ? null : effortOption.value}
          onChange={(mode) =>
            useChatSettingsStore.getState().setThinkingMode(DEFAULT_CHAT_SETTINGS_KEY, mode)
          }
        />
      ),
    });
  }
  if (personaModel && personas.length > 0) {
    const option = getPersonaOption(shared.persona, personaOptions);
    settingRows.push({
      key: 'persona',
      label: 'Persona',
      value: mixed.persona ? 'Mixed' : option.label,
      options: (
        <OptionList
          options={personaOptions}
          value={mixed.persona ? null : option.value}
          onChange={(persona) =>
            useChatSettingsStore.getState().setPersona(DEFAULT_CHAT_SETTINGS_KEY, persona)
          }
        />
      ),
    });
  }
  if (first) {
    const modes = MODES_BY_AGENT[first.agent_kind];
    const value = coercePermissionModeForAgent(shared.permissionMode, first.agent_kind);
    settingRows.push({
      key: 'permission',
      label: 'Permission',
      value: mixed.permissionMode
        ? 'Mixed'
        : (modes.find((mode) => mode.value === value)?.label ?? value),
      options: (
        <OptionList
          options={modes}
          value={mixed.permissionMode ? null : value}
          onChange={(mode) =>
            useChatSettingsStore.getState().setPermissionMode(DEFAULT_CHAT_SETTINGS_KEY, mode)
          }
        />
      ),
    });
  }
  // Channel members take no fast mode
  if (!isGroup && first && supportsFastMode(first, first.agent_kind)) {
    const option = fastMode ? FAST_MODE_OPTIONS[1] : FAST_MODE_OPTIONS[0];
    settingRows.push({
      key: 'fast',
      label: 'Fast mode',
      value: option.label,
      options: (
        <OptionList
          options={FAST_MODE_OPTIONS.map((mode) => ({
            value: String(mode.value),
            label: mode.label,
          }))}
          value={String(option.value)}
          onChange={(enabled) =>
            useChatSettingsStore
              .getState()
              .setFastMode(DEFAULT_CHAT_SETTINGS_KEY, enabled === 'true')
          }
        />
      ),
    });
  }

  // Arrow keys walk the model rows, then the setting rows
  const navigable: Highlight[] = [
    ...entries.map((entry) => entry.highlight),
    ...settingRows.map((row) => ({ kind: 'setting' as const, key: row.key })),
  ];
  const activeHighlight =
    highlight && navigable.some((item) => sameHighlight(highlight, item))
      ? highlight
      : (navigable[0] ?? null);
  const activeEntry = entries.find((entry) => sameHighlight(activeHighlight, entry.highlight));

  // A section whose row went away (member removed, setting no longer applies) is closed
  const sectionMember =
    openSection?.kind === 'member'
      ? members.find((member) => member.key === openSection.key)
      : undefined;
  const sectionSetting =
    openSection?.kind === 'setting'
      ? settingRows.find((row) => row.key === openSection.key)
      : undefined;
  const sectionModel = sectionMember && modelById.get(sectionMember.modelId);
  const hasSection = !!sectionSetting || !!sectionModel;
  const toggleSection = (section: Section) =>
    setOpenSection(sameSection(openSection, section) ? null : section);

  // A model row with one member stands for that member
  const entryMember = (entry: Entry) => {
    if (entry.member) return entry.member;
    const own = membersOf(entry.model.model_id);
    return own.length === 1 ? own[0] : undefined;
  };

  const toggle = (entry: Entry) => {
    if (entry.member) {
      onChange(members.filter((member) => member.key !== entry.member!.key));
    } else if (membersOf(entry.model.model_id).length > 0) {
      onChange(members.filter((member) => member.modelId !== entry.model.model_id));
    } else {
      onChange([...members, newGroupMember(entry.model.model_id)]);
    }
  };

  const moveHighlight = (step: number) => {
    if (navigable.length === 0) return;
    const index = navigable.findIndex((item) => sameHighlight(activeHighlight, item));
    const next = navigable[(index + step + navigable.length) % navigable.length];
    setHighlight(next);
    // Phones keep the list in view while arrowing; the drill-in opens on Enter
    setOpenSection(next.kind === 'setting' && !isMobile ? next : null);
    document.getElementById(entryId(next))?.scrollIntoView({ block: 'nearest' });
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      moveHighlight(event.key === 'ArrowDown' ? 1 : -1);
    } else if (event.key === 'Enter' || (event.key === ' ' && !query)) {
      event.preventDefault();
      if (activeEntry) toggle(activeEntry);
      else if (activeHighlight?.kind === 'setting') toggleSection(activeHighlight);
    } else if (event.key === 'Escape' && query) {
      event.preventDefault();
      setQuery('');
    }
  };

  // Escape closes the section before the panel; the dropdown skips prevented Escapes
  const handlePanelKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && hasSection && !event.defaultPrevented) {
      event.preventDefault();
      setOpenSection(null);
    }
  };

  const favoriteButton = (model: Model) => {
    const isFavorite = favoriteModelIds.includes(model.model_id);
    return (
      <Button
        type="button"
        variant="unstyled"
        tabIndex={-1}
        aria-label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
        aria-pressed={isFavorite}
        onClick={(event) => {
          event.stopPropagation();
          useModelStore.getState().toggleFavoriteModel(model.model_id);
        }}
        className={clsx(styles.action, isFavorite && styles['action--pinned'])}
      >
        <Star className={clsx(styles['action-icon'], isFavorite && styles['star--on'])} />
      </Button>
    );
  };

  const renderEntry = (entry: Entry) => {
    const { model, member } = entry;
    const count = membersOf(model.model_id).length;
    const ownMember = entryMember(entry);
    const memberSection: Section | null = ownMember ? { kind: 'member', key: ownMember.key } : null;
    const isSectionOpen = !!memberSection && sameSection(openSection, memberSection);
    const hasOverrides = !!ownMember && Object.keys(ownMember.overrides).length > 0;
    const memberIndex = member ? members.indexOf(member) : -1;
    const meta = [
      model.context_window ? formatNumberCompact(model.context_window) : null,
      model.legacy ? 'Legacy' : null,
    ]
      .filter(Boolean)
      .join(' · ');
    return (
      <div
        key={entryId(entry.highlight)}
        id={entryId(entry.highlight)}
        role="option"
        aria-selected={member ? true : count > 0}
        onMouseEnter={() => !isMobile && setHighlight(entry.highlight)}
        onClick={() => {
          setHighlight(entry.highlight);
          setOpenSection(null);
          toggle(entry);
        }}
        className={clsx(
          styles.row,
          member && styles['row--member'],
          (sameHighlight(activeHighlight, entry.highlight) || isSectionOpen) &&
            styles['row--active'],
        )}
      >
        {!member && <ProviderIcon agentKind={model.agent_kind} className={styles['row-icon']} />}
        <span className={styles['row-name']}>{member ? names[memberIndex].name : model.name}</span>
        {!member && meta && <span className={styles['row-meta']}>{meta}</span>}
        <span className={styles['row-actions']}>
          {!member && count > 0 && (
            <Button
              type="button"
              variant="unstyled"
              tabIndex={-1}
              aria-label={`Add another ${model.name}`}
              onClick={(event) => {
                event.stopPropagation();
                onChange([...members, newGroupMember(model.model_id)]);
              }}
              className={styles.action}
            >
              <Plus className={styles['action-icon']} />
            </Button>
          )}
          {!member && favoriteButton(model)}
          {ownMember && memberSection && (
            <Button
              type="button"
              variant="unstyled"
              aria-label={`${names[members.indexOf(ownMember)].name} settings`}
              aria-expanded={isSectionOpen}
              onClick={(event) => {
                event.stopPropagation();
                setHighlight(entry.highlight);
                toggleSection(memberSection);
              }}
              className={clsx(
                styles.action,
                (hasOverrides || isSectionOpen) && styles['action--pinned'],
              )}
            >
              <ChevronRight className={styles['action-icon']} />
            </Button>
          )}
        </span>
        <span className={styles.tick}>
          {count > 1 && !member && <span className={styles.count}>×{count}</span>}
          {(member || count > 0) && <Check className={styles['tick-icon']} />}
        </span>
      </div>
    );
  };

  const sectionContent = sectionSetting ? (
    <>
      <p className={styles['section-title']}>
        {sectionSetting.label} for {isGroup ? 'all agents' : first?.name}
      </p>
      {sectionSetting.options}
    </>
  ) : sectionMember && sectionModel ? (
    <MemberSection
      model={sectionModel}
      draft={drafts[members.indexOf(sectionMember)]}
      memberName={names[members.indexOf(sectionMember)]}
      isGroup={isGroup}
      hasOverrides={Object.keys(sectionMember.overrides).length > 0}
      personas={personas}
      onChange={(patch) =>
        onChange(members.map((m) => (m.key === sectionMember.key ? patchGroupMember(m, patch) : m)))
      }
      onReset={() =>
        onChange(members.map((m) => (m.key === sectionMember.key ? { ...m, overrides: {} } : m)))
      }
      onRemove={() => {
        setOpenSection(null);
        onChange(members.filter((m) => m.key !== sectionMember.key));
      }}
    />
  ) : null;
  const isDrilledIn = isMobile && hasSection;

  const effortSummary =
    !isGroup && effortOption && thinkingModel === first ? ` · ${effortOption.label}` : '';
  const isMixed = mixed.thinkingMode || mixed.persona || mixed.permissionMode;

  return (
    <div ref={dropdownRef} className={styles.picker}>
      <Button
        type="button"
        variant="unstyled"
        disabled={disabled}
        onClick={() => setIsOpen(!isOpen)}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        className={styles.trigger}
      >
        {isGroup ? (
          <ProviderIconStack agentKinds={memberModels.map((m) => m.agent_kind)} />
        ) : first ? (
          <ProviderIcon agentKind={first.agent_kind} />
        ) : (
          <Box aria-hidden />
        )}
        <span className={styles['trigger-label']}>
          {isGroup
            ? `${members.length} agents${isMixed ? ' · Mixed' : ''}`
            : first
              ? `${first.name}${effortSummary}`
              : 'Choose a model'}
        </span>
      </Button>

      {isOpen && !disabled && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Models"
          onKeyDown={handlePanelKeyDown}
          style={{ maxHeight: fit?.maxHeight, transform: panelTransform }}
          className={clsx(
            styles.panel,
            fit?.side === 'top' && styles['panel--top'],
            hasSection && !isMobile && styles['panel--wide'],
          )}
        >
          {isDrilledIn ? (
            <>
              <Button
                type="button"
                variant="unstyled"
                onClick={() => setOpenSection(null)}
                className={styles.back}
              >
                <ChevronLeft className={styles['action-icon']} />
                Models
              </Button>
              <div className={styles.section}>{sectionContent}</div>
            </>
          ) : (
            <>
              <div className={styles.search}>
                <Search className={styles['search-icon']} />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setHighlight(null);
                    listRef.current?.scrollTo({ top: 0 });
                  }}
                  onKeyDown={handleKeyDown}
                  placeholder="Choose a model…"
                  aria-label="Choose a model"
                  aria-controls="model-picker-list"
                  aria-activedescendant={activeHighlight ? entryId(activeHighlight) : undefined}
                  autoFocus={!isMobile}
                  className={styles['search-input']}
                />
              </div>
              <div className={styles.body}>
                <div className={styles.left}>
                  <div
                    ref={listRef}
                    id="model-picker-list"
                    role="listbox"
                    aria-multiselectable
                    aria-label="Models"
                    className={styles.list}
                  >
                    {sectionEntries.map((section, index) => (
                      <Fragment key={index}>
                        {index > 0 && <div role="separator" className={styles.divider} />}
                        {section.map(renderEntry)}
                      </Fragment>
                    ))}
                    {entries.length === 0 && <p className={styles.empty}>No models match</p>}
                  </div>
                  {settingRows.length > 0 && (
                    <div className={styles.settings}>
                      {settingRows.map((row) => {
                        const rowSection: Section = { kind: 'setting', key: row.key };
                        const isRowOpen = sameSection(openSection, rowSection);
                        return (
                          <Button
                            key={row.key}
                            id={entryId(rowSection)}
                            type="button"
                            variant="unstyled"
                            aria-expanded={isRowOpen}
                            onClick={() => {
                              setHighlight(rowSection);
                              toggleSection(rowSection);
                            }}
                            className={clsx(
                              styles.setting,
                              (isRowOpen || sameHighlight(activeHighlight, rowSection)) &&
                                styles['setting--active'],
                            )}
                          >
                            <span className={styles['setting-label']}>{row.label}</span>
                            <span className={styles['setting-value']}>{row.value}</span>
                            <ChevronRight className={styles['setting-chevron']} />
                          </Button>
                        );
                      })}
                    </div>
                  )}
                </div>
                {hasSection && <div className={styles.section}>{sectionContent}</div>}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
