import { memo } from 'react';
import { useChatSettings } from '@/hooks/useChatSettings';
import clsx from 'clsx';
import { Brain } from 'lucide-react';
import { Dropdown, type DropdownPosition } from '@/components/ui/primitives/Dropdown/Dropdown';
import { useChatSettingsStore, DEFAULT_CHAT_SETTINGS_KEY } from '@/store/chatSettingsStore';
import type { AgentKind, Model } from '@/types/chat.types';
import { getThinkingModeOption, getThinkingModesForAgent } from './thinkingModes';
import styles from './ThinkingModeSelector.module.scss';

interface ThinkingModeControlProps {
  agentKind?: AgentKind;
  model?: Model;
  dropdownPosition?: DropdownPosition;
  disabled?: boolean;
  compact?: boolean;
  variant?: 'default' | 'text';
  dropdownAlign?: 'left' | 'right';
  onInlineSelect?: () => void;
}

export interface ThinkingModeDropdownProps extends ThinkingModeControlProps {
  value: string;
  onChange: (mode: string) => void;
}

export const ThinkingModeDropdown = memo(function ThinkingModeDropdown({
  value,
  onChange,
  agentKind,
  model,
  dropdownPosition = 'bottom',
  dropdownAlign,
  disabled = false,
  compact = true,
  variant = 'default',
  onInlineSelect,
}: ThinkingModeDropdownProps) {
  const resolvedAgentKind = agentKind ?? 'claude';

  const modes = getThinkingModesForAgent(resolvedAgentKind, model);
  const selectedMode = getThinkingModeOption(value, resolvedAgentKind, model);

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
      ariaLabel="Thinking mode"
      width="8rem"
      dropdownPosition={dropdownPosition}
      disabled={disabled}
      compact={compact}
      triggerVariant={variant}
      dropdownAlign={dropdownAlign}
      onInlineSelect={onInlineSelect}
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
  const { thinkingMode } = useChatSettings(chatId);

  return (
    <ThinkingModeDropdown
      value={thinkingMode}
      onChange={(mode) => useChatSettingsStore.getState().setThinkingMode(key, mode)}
      {...controlProps}
    />
  );
});
