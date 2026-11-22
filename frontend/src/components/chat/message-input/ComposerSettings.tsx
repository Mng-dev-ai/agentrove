import { useLayoutEffect, useRef, useState } from 'react';
import type { ComponentType, ReactNode, SVGProps } from 'react';
import { Brain, ChevronLeft, ChevronRight, Shield, UserCircle, X, Zap } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button/Button';
import { BaseModal } from '@/components/ui/shared/BaseModal/BaseModal';
import { AGENT_ICONS } from '@/components/ui/icons/providerIcons';
import { ModelSelector } from '@/components/chat/model-selector/ModelSelector';
import { ThinkingModeSelector } from '@/components/chat/thinking-mode-selector/ThinkingModeSelector';
import { getThinkingModeOption } from '@/components/chat/thinking-mode-selector/thinkingModes';
import { FastModeSelector } from '@/components/chat/fast-mode-selector/FastModeSelector';
import { PermissionModeSelector } from '@/components/chat/permission-mode-selector/PermissionModeSelector';
import { getPermissionModeOption } from '@/components/chat/permission-mode-selector/permissionModes';
import { useFastModeOption } from '@/components/chat/fast-mode-selector/fastModes';
import { PersonaSelector } from '@/components/chat/persona-selector/PersonaSelector';
import {
  getPersonaOption,
  getPersonaOptions,
} from '@/components/chat/persona-selector/personaOptions';
import { useInputContext } from '@/hooks/useInputContext';
import { useChatContext } from '@/hooks/useChatContext';
import { useChatSettings } from '@/hooks/useChatSettings';
import { preventBlur, type ComposerSettingsInfo } from './useComposerSettings';
import styles from './ComposerSettings.module.scss';

type SettingKey = 'model' | 'thinking' | 'fast' | 'permission' | 'persona';
type SheetView = 'list' | SettingKey;

interface SettingRow {
  key: SettingKey;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  name: string;
  value: string;
  options: ReactNode;
}

export function MobileComposerSettings({ settings }: { settings: ComposerSettingsInfo }) {
  const { state, actions } = useInputContext();
  const { personas } = useChatContext();
  const { selectedModel, agentKind, showPersona, showFastMode } = settings;
  const agent = agentKind ?? 'claude';
  const { permissionMode, thinkingMode, persona } = useChatSettings(state.chatId);
  const fastOption = useFastModeOption(state.chatId);
  const [open, setOpen] = useState(false);
  // Kept while closing so the sheet slides out with the content it showed
  const [view, setView] = useState<SheetView>('list');
  // The sheet's selectors can't be disabled, so loading closes the sheet as the triggers lock
  if (state.isLoading && open) setOpen(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const bodyHeight = useRef(0);

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

  // Keeps the starting height current when a filter or a running transition resizes the body
  // between view switches
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!open || !body) return;
    const observer = new ResizeObserver(() => {
      bodyHeight.current = body.offsetHeight;
    });
    observer.observe(body);
    return () => observer.disconnect();
  }, [open]);

  // Eases the body from the previous view's height to the new one via its CSS height
  // transition (none under reduced motion). The target waits until the new view has painted
  // once at the old height, so its first (slow) layout doesn't eat the transition's start.
  useLayoutEffect(() => {
    const body = bodyRef.current;
    const from = bodyHeight.current;
    bodyHeight.current = 0;
    if (!open || !body) return;
    body.style.height = '';
    const to = body.offsetHeight;
    bodyHeight.current = to;
    if (!from || from === to || getComputedStyle(body).transitionDuration === '0s') return;
    body.style.height = `${from}px`;
    body.getBoundingClientRect();
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        body.style.height = `${to}px`;
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [open, view]);

  const activeRow = rows.find((row) => row.key === view);

  return (
    <>
      <Button
        type="button"
        variant="unstyled"
        disabled={state.isLoading}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Chat settings: ${triggerLabel}`}
        onMouseDown={preventBlur}
        onClick={() => {
          setView('list');
          setOpen(true);
        }}
        className={styles.trigger}
      >
        <ModelIcon className={styles['trigger-icon']} />
        <span className={styles['trigger-label']}>{triggerLabel}</span>
      </Button>

      <BaseModal
        isOpen={open}
        onClose={() => setOpen(false)}
        variant="sheet"
        ariaLabel="Chat settings"
      >
        <div className={styles.header}>
          {activeRow ? (
            <Button
              type="button"
              variant="unstyled"
              aria-label="Back"
              onClick={showBack}
              className={styles['header-button']}
            >
              <ChevronLeft />
            </Button>
          ) : (
            <Button
              type="button"
              variant="unstyled"
              aria-label="Close"
              onClick={() => setOpen(false)}
              className={styles['header-button']}
            >
              <X />
            </Button>
          )}
          <h3 className={styles.title}>{activeRow ? activeRow.name : 'Chat settings'}</h3>
        </div>
        <div
          ref={bodyRef}
          className={styles.body}
          onTransitionEnd={(e) => {
            if (e.target === e.currentTarget) e.currentTarget.style.height = '';
          }}
        >
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
