import { useLayoutEffect, useRef, useState } from 'react';
import type { ComponentType, ReactNode, SVGProps } from 'react';
import clsx from 'clsx';
import { Brain, ChevronLeft, ChevronRight, Shield, UserCircle, X, Zap } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button/Button';
import { BaseModal } from '@/components/ui/shared/BaseModal/BaseModal';
import { AGENT_ICONS } from '@/components/ui/icons/providerIcons';
import { ModelSelector } from '@/components/chat/model-selector/ModelSelector';
import { ThinkingModeSelector } from '@/components/chat/thinking-mode-selector/ThinkingModeSelector';
import { getThinkingModeOption } from '@/components/chat/thinking-mode-selector/thinkingModes';
import { FastModeSelector } from '@/components/chat/fast-mode-selector/FastModeSelector';
import { PermissionModeSelector } from '@/components/chat/permission-mode-selector/PermissionModeSelector';
import {
  getPermissionModeOption,
  isDefaultPermissionMode,
} from '@/components/chat/permission-mode-selector/permissionModes';
import { useFastModeOption } from '@/components/chat/fast-mode-selector/fastModes';
import { PersonaSelector } from '@/components/chat/persona-selector/PersonaSelector';
import {
  DEFAULT_PERSONA_OPTION,
  getPersonaOption,
  getPersonaOptions,
} from '@/components/chat/persona-selector/personaOptions';
import { useInputContext } from '@/hooks/useInputContext';
import { useChatContext } from '@/hooks/useChatContext';
import { useChatSettings } from '@/hooks/useChatSettings';
import { preventBlur, type ComposerSettingsInfo } from './useComposerSettings';
import styles from './ComposerSettings.module.scss';

// The main label keeps at least this many of its own em before the chips give up their labels
const MIN_READABLE_LABEL_EM = 8;

type SettingKey = 'model' | 'thinking' | 'fast' | 'permission' | 'persona';
type SheetView = 'list' | SettingKey;
type ChipTone = 'warning' | 'accent';

interface SettingRow {
  key: SettingKey;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  name: string;
  value: string;
  options: ReactNode;
}

interface Chip {
  key: SettingKey;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  label: string;
  ariaLabel: string;
  tone: ChipTone;
}

export function MobileComposerSettings({ settings }: { settings: ComposerSettingsInfo }) {
  const { state, actions } = useInputContext();
  const { personas } = useChatContext();
  const { selectedModel, agentKind, showPersona, showFastMode } = settings;
  const agent = agentKind ?? 'claude';
  const { permissionMode, thinkingMode, persona } = useChatSettings(state.chatId);
  const fastOption = useFastModeOption(state.chatId);
  const [view, setView] = useState<SheetView | null>(null);
  // The sheet's selectors can't be disabled, so loading closes the sheet as the triggers lock
  if (state.isLoading && view !== null) setView(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLSpanElement>(null);

  const thinking = getThinkingModeOption(thinkingMode, agent, selectedModel);
  const permission = getPermissionModeOption(permissionMode, agent);
  const personaOption = getPersonaOption(persona, getPersonaOptions(personas));
  const ModelIcon = selectedModel ? AGENT_ICONS[selectedModel.agent_kind] : Brain;
  const modelName = selectedModel?.name ?? 'Model';
  const triggerLabel = thinking ? `${modelName} · ${thinking.label}` : modelName;
  const showBack = () => setView('list');

  const rows: SettingRow[] = [
    {
      key: 'model',
      icon: ModelIcon,
      name: 'Model',
      value: modelName,
      options: (
        <ModelSelector
          selectedModelId={state.selectedModelId}
          onModelChange={actions.onModelChange}
          machineId={state.machineId}
          onInlineSelect={showBack}
        />
      ),
    },
  ];
  if (thinking) {
    rows.push({
      key: 'thinking',
      icon: Brain,
      name: 'Thinking',
      value: thinking.label,
      options: (
        <ThinkingModeSelector
          chatId={state.chatId}
          agentKind={agentKind}
          model={selectedModel}
          onInlineSelect={showBack}
        />
      ),
    });
  }
  if (showFastMode) {
    rows.push({
      key: 'fast',
      icon: Zap,
      name: 'Fast mode',
      value: fastOption.label,
      options: (
        <FastModeSelector chatId={state.chatId} agentKind={agentKind} onInlineSelect={showBack} />
      ),
    });
  }
  rows.push({
    key: 'permission',
    icon: Shield,
    name: 'Permissions',
    value: permission.label,
    options: (
      <PermissionModeSelector
        chatId={state.chatId}
        agentKind={agentKind}
        onInlineSelect={showBack}
      />
    ),
  });
  if (showPersona) {
    rows.push({
      key: 'persona',
      icon: UserCircle,
      name: 'Persona',
      value: personaOption.label,
      options: <PersonaSelector chatId={state.chatId} onInlineSelect={showBack} />,
    });
  }

  const chips: Chip[] = [];
  if (!isDefaultPermissionMode(permission.value, agent)) {
    chips.push({
      key: 'permission',
      icon: Shield,
      label: permission.label,
      ariaLabel: `Permission mode: ${permission.label}`,
      tone: 'warning',
    });
  }
  if (showPersona && personaOption !== DEFAULT_PERSONA_OPTION) {
    chips.push({
      key: 'persona',
      icon: UserCircle,
      label: personaOption.label,
      ariaLabel: `Persona: ${personaOption.label}`,
      tone: 'accent',
    });
  }
  if (showFastMode && fastOption.value) {
    chips.push({
      key: 'fast',
      icon: Zap,
      label: fastOption.label,
      ariaLabel: `Fast mode: ${fastOption.label}`,
      tone: 'warning',
    });
  }

  const chipLabels = chips.map((chip) => chip.label).join('\n');

  // Chips drop their labels only when keeping them would squeeze the main label below a
  // readable width: try the labelled layout, measure, and collapse within the same frame.
  useLayoutEffect(() => {
    const row = rowRef.current;
    const label = labelRef.current;
    const form = row?.closest('form');
    if (!row || !label || !form) return;
    const measure = () => {
      row.removeAttribute('data-compact');
      const readable = parseFloat(getComputedStyle(label).fontSize) * MIN_READABLE_LABEL_EM;
      if (label.clientWidth < Math.min(label.scrollWidth, readable)) {
        row.setAttribute('data-compact', '');
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(form);
    return () => observer.disconnect();
  }, [chipLabels, triggerLabel, state.hasMessage]);

  const activeRow = rows.find((row) => row.key === view);

  return (
    <>
      <div ref={rowRef} className={styles.row} onMouseDown={preventBlur}>
        {chips.map((chip) => (
          <Button
            key={chip.key}
            type="button"
            variant="unstyled"
            disabled={state.isLoading}
            aria-label={chip.ariaLabel}
            onClick={() => setView(chip.key)}
            className={clsx(styles.chip, styles[`chip--${chip.tone}`])}
          >
            <chip.icon className={styles['chip-icon']} />
            <span className={styles['chip-label']}>{chip.label}</span>
          </Button>
        ))}
        <Button
          type="button"
          variant="unstyled"
          disabled={state.isLoading}
          aria-haspopup="dialog"
          aria-expanded={view !== null}
          aria-label={`Chat settings: ${triggerLabel}`}
          onClick={() => setView('list')}
          className={styles.trigger}
        >
          <ModelIcon className={styles['trigger-icon']} />
          <span ref={labelRef} className={styles['trigger-label']}>
            {triggerLabel}
          </span>
        </Button>
      </div>

      <BaseModal
        isOpen={view !== null}
        onClose={() => setView(null)}
        variant="sheet"
        ariaLabel="Chat settings"
      >
        <div className={styles.header}>
          {activeRow && (
            <Button
              type="button"
              variant="unstyled"
              aria-label="Back"
              onClick={showBack}
              className={styles['header-button']}
            >
              <ChevronLeft />
            </Button>
          )}
          <h3 className={styles.title}>{activeRow ? activeRow.name : 'Chat settings'}</h3>
          <Button
            type="button"
            variant="unstyled"
            aria-label="Close"
            onClick={() => setView(null)}
            className={styles['header-button']}
          >
            <X />
          </Button>
        </div>
        <div className={styles.body}>
          {activeRow ? (
            activeRow.options
          ) : (
            <div className={styles.rows}>
              {rows.map((row) => (
                <Button
                  key={row.key}
                  type="button"
                  variant="unstyled"
                  onClick={() => setView(row.key)}
                  className={styles['setting-row']}
                >
                  <row.icon className={styles['setting-icon']} />
                  <span className={styles['setting-name']}>{row.name}</span>
                  <span className={styles['setting-value']}>{row.value}</span>
                  <ChevronRight className={styles['setting-chevron']} />
                </Button>
              ))}
            </div>
          )}
        </div>
      </BaseModal>
    </>
  );
}
