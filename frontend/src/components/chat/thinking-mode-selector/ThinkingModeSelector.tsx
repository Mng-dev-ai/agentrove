import { memo } from 'react';
import { Brain } from 'lucide-react';
import { Dropdown } from '@/components/ui/primitives/Dropdown';
import {
  useChatSettingsStore,
  DEFAULT_CHAT_SETTINGS_KEY,
  DEFAULT_THINKING_MODE,
} from '@/store/chatSettingsStore';
import { useIsSplitMode } from '@/hooks/useIsSplitMode';
import type { AgentKind } from '@/types/chat.types';
import { getThinkingModesForAgent, getThinkingModeOption } from './thinkingModes';

export interface ThinkingModeSelectorProps {
  chatId?: string;
  agentKind?: AgentKind;
  modelId?: string;
  dropdownPosition?: 'top' | 'bottom';
  disabled?: boolean;
  variant?: 'default' | 'text';
  dropdownAlign?: 'left' | 'right';
}

export const ThinkingModeSelector = memo(function ThinkingModeSelector({
  chatId,
  agentKind,
  modelId,
  dropdownPosition = 'bottom',
  dropdownAlign,
  disabled = false,
  variant = 'default',
}: ThinkingModeSelectorProps) {
  const key = chatId ?? DEFAULT_CHAT_SETTINGS_KEY;
  const resolvedAgentKind = agentKind ?? 'claude';
  const thinkingMode = useChatSettingsStore(
    (state) => state.thinkingModeByChat[key] ?? DEFAULT_THINKING_MODE,
  );
  const isSplitMode = useIsSplitMode();

  const modes = getThinkingModesForAgent(resolvedAgentKind, modelId);
  const selectedMode = getThinkingModeOption(thinkingMode, resolvedAgentKind, modelId);

  // Some agents (e.g. Cursor) don't expose a thinking-mode control because
  // reasoning effort is chosen at the model level. Hide the selector entirely.
  if (!selectedMode || modes.length === 0) return null;

  return (
    <Dropdown
      value={selectedMode}
      items={modes}
      getItemKey={(mode) => mode.value}
      getItemLabel={(mode) => mode.label}
      onSelect={(mode) => useChatSettingsStore.getState().setThinkingMode(key, mode.value)}
      leftIcon={Brain}
      width="w-32"
      dropdownPosition={dropdownPosition}
      disabled={disabled}
      compactOnMobile
      forceCompact={isSplitMode}
      triggerVariant={variant}
      dropdownAlign={dropdownAlign}
      renderItem={(mode, isSelected) => (
        <span
          className={`text-2xs font-medium ${isSelected ? 'text-text-primary dark:text-text-dark-primary' : 'text-text-secondary dark:text-text-dark-secondary'}`}
        >
          {mode.label}
        </span>
      )}
    />
  );
});
