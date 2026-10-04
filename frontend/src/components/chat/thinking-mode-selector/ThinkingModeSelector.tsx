import { memo } from 'react';
import clsx from 'clsx';
import { Brain } from 'lucide-react';
import { Dropdown } from '@/components/ui/primitives/Dropdown/Dropdown';
import {
  useChatSettingsStore,
  DEFAULT_CHAT_SETTINGS_KEY,
  DEFAULT_THINKING_MODE,
} from '@/store/chatSettingsStore';
import { useIsSplitMode } from '@/hooks/useIsSplitMode';
import type { AgentKind } from '@/types/chat.types';
import { getThinkingModesForAgent, getThinkingModeOption } from './thinkingModes';
import styles from './ThinkingModeSelector.module.scss';

interface ThinkingModeControlProps {
  agentKind?: AgentKind;
  modelId?: string;
  dropdownPosition?: 'top' | 'bottom';
  disabled?: boolean;
  variant?: 'default' | 'text';
  dropdownAlign?: 'left' | 'right';
}

export interface ThinkingModeDropdownProps extends ThinkingModeControlProps {
  value: string;
  onChange: (mode: string) => void;
}

export const ThinkingModeDropdown = memo(function ThinkingModeDropdown({
  value,
  onChange,
  agentKind,
  modelId,
  dropdownPosition = 'bottom',
  dropdownAlign,
  disabled = false,
  variant = 'default',
}: ThinkingModeDropdownProps) {
  const resolvedAgentKind = agentKind ?? 'claude';
  const isSplitMode = useIsSplitMode();

  const modes = getThinkingModesForAgent(resolvedAgentKind, modelId);
  const selectedMode = getThinkingModeOption(value, resolvedAgentKind, modelId);

  // Some agents (e.g. Cursor) don't expose a thinking-mode control because
  // reasoning effort is chosen at the model level. Hide the selector entirely.
  if (!selectedMode || modes.length === 0) return null;

  return (
    <Dropdown
      value={selectedMode}
      items={modes}
      getItemKey={(mode) => mode.value}
      getItemLabel={(mode) => mode.label}
      onSelect={(mode) => onChange(mode.value)}
      leftIcon={Brain}
      width="8rem"
      dropdownPosition={dropdownPosition}
      disabled={disabled}
      compactOnMobile
      forceCompact={isSplitMode}
      triggerVariant={variant}
      dropdownAlign={dropdownAlign}
      renderItem={(mode, isSelected) => (
        <span className={clsx(styles['mode-label'], isSelected && styles['mode-label--selected'])}>
          {mode.label}
        </span>
      )}
    />
  );
});

export interface ThinkingModeSelectorProps extends ThinkingModeControlProps {
  chatId?: string;
}

export const ThinkingModeSelector = memo(function ThinkingModeSelector({
  chatId,
  ...controlProps
}: ThinkingModeSelectorProps) {
  const key = chatId ?? DEFAULT_CHAT_SETTINGS_KEY;
  const thinkingMode = useChatSettingsStore(
    (state) => state.thinkingModeByChat[key] ?? DEFAULT_THINKING_MODE,
  );

  return (
    <ThinkingModeDropdown
      value={thinkingMode}
      onChange={(mode) => useChatSettingsStore.getState().setThinkingMode(key, mode)}
      {...controlProps}
    />
  );
});
