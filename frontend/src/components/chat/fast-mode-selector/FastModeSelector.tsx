import { memo } from 'react';
import clsx from 'clsx';
import { Zap } from 'lucide-react';
import { Dropdown, type DropdownPosition } from '@/components/ui/primitives/Dropdown/Dropdown';
import { useChatSettingsStore, DEFAULT_CHAT_SETTINGS_KEY } from '@/store/chatSettingsStore';
import type { AgentKind } from '@/types/chat.types';
import { FAST_MODE_OPTIONS, useFastModeOption } from './fastModes';
import styles from './FastModeSelector.module.scss';

export interface FastModeSelectorProps {
  chatId?: string;
  agentKind?: AgentKind;
  dropdownPosition?: DropdownPosition;
  disabled?: boolean;
  variant?: 'default' | 'text';
  dropdownAlign?: 'left' | 'right';
  onInlineSelect?: () => void;
}

export const FastModeSelector = memo(function FastModeSelector({
  chatId,
  agentKind,
  dropdownPosition = 'bottom',
  dropdownAlign,
  disabled = false,
  variant = 'default',
  onInlineSelect,
}: FastModeSelectorProps) {
  const key = chatId ?? DEFAULT_CHAT_SETTINGS_KEY;
  const selected = useFastModeOption(chatId);

  // codex-acp only advertises Fast mode; hide for every other agent.
  if (agentKind !== 'codex') return null;

  return (
    <Dropdown
      value={selected}
      items={FAST_MODE_OPTIONS}
      getItemKey={(mode) => String(mode.value)}
      getItemLabel={(mode) => mode.label}
      onSelect={(mode) => useChatSettingsStore.getState().setFastMode(key, mode.value)}
      leftIcon={Zap}
      ariaLabel="Fast mode"
      width="8rem"
      dropdownPosition={dropdownPosition}
      disabled={disabled}
      compact
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
