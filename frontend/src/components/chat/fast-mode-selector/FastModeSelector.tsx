import { memo } from 'react';
import clsx from 'clsx';
import { Zap } from 'lucide-react';
import { Dropdown } from '@/components/ui/primitives/Dropdown/Dropdown';
import {
  useChatSettingsStore,
  DEFAULT_CHAT_SETTINGS_KEY,
  DEFAULT_FAST_MODE,
} from '@/store/chatSettingsStore';
import { useIsSplitMode } from '@/hooks/useIsSplitMode';
import type { AgentKind } from '@/types/chat.types';
import styles from './FastModeSelector.module.scss';

const FAST_MODE_OPTIONS = [
  { value: false as const, label: 'Normal' },
  { value: true as const, label: 'Fast' },
] as const;

type FastModeOption = (typeof FAST_MODE_OPTIONS)[number];

export interface FastModeSelectorProps {
  chatId?: string;
  agentKind?: AgentKind;
  dropdownPosition?: 'top' | 'bottom';
  disabled?: boolean;
  variant?: 'default' | 'text';
  dropdownAlign?: 'left' | 'right';
}

export const FastModeSelector = memo(function FastModeSelector({
  chatId,
  agentKind,
  dropdownPosition = 'bottom',
  dropdownAlign,
  disabled = false,
  variant = 'default',
}: FastModeSelectorProps) {
  const key = chatId ?? DEFAULT_CHAT_SETTINGS_KEY;
  const fastMode = useChatSettingsStore((state) => state.fastModeByChat[key] ?? DEFAULT_FAST_MODE);
  const isSplitMode = useIsSplitMode();

  // codex-acp only advertises Fast mode; hide for every other agent.
  if (agentKind !== 'codex') return null;

  const selected: FastModeOption = fastMode ? FAST_MODE_OPTIONS[1] : FAST_MODE_OPTIONS[0];

  return (
    <Dropdown
      value={selected}
      items={FAST_MODE_OPTIONS}
      getItemKey={(mode) => String(mode.value)}
      getItemLabel={(mode) => mode.label}
      onSelect={(mode) => useChatSettingsStore.getState().setFastMode(key, mode.value)}
      leftIcon={Zap}
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
