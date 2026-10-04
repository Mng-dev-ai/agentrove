import { memo } from 'react';
import clsx from 'clsx';
import { Shield } from 'lucide-react';
import { Dropdown, type DropdownPosition } from '@/components/ui/primitives/Dropdown/Dropdown';
import { useIsSplitMode } from '@/hooks/useIsSplitMode';
import {
  useChatSettingsStore,
  DEFAULT_CHAT_SETTINGS_KEY,
  DEFAULT_PERMISSION_MODE,
  type PermissionMode,
} from '@/store/chatSettingsStore';
import type { AgentKind } from '@/types/chat.types';
import {
  MODES_BY_AGENT,
  getPermissionModeOption,
  type PermissionModeOption,
} from './permissionModes';
import styles from './PermissionModeSelector.module.scss';

function renderPermissionItem(mode: PermissionModeOption, isSelected: boolean) {
  return (
    <>
      <span className={clsx(styles['mode-label'], isSelected && styles['mode-label--selected'])}>
        {mode.label}
      </span>
      <span className={styles['mode-description']}>{mode.description}</span>
    </>
  );
}

interface PermissionModeControlProps {
  agentKind?: AgentKind;
  dropdownPosition?: DropdownPosition;
  disabled?: boolean;
  variant?: 'default' | 'text';
  dropdownAlign?: 'left' | 'right';
}

export interface PermissionModeDropdownProps extends PermissionModeControlProps {
  value: PermissionMode;
  onChange: (mode: PermissionMode) => void;
}

export const PermissionModeDropdown = memo(function PermissionModeDropdown({
  value,
  onChange,
  agentKind,
  dropdownPosition = 'bottom',
  dropdownAlign,
  disabled = false,
  variant = 'default',
}: PermissionModeDropdownProps) {
  const resolvedAgentKind = agentKind ?? 'claude';
  const isSplitMode = useIsSplitMode();

  const modes = MODES_BY_AGENT[resolvedAgentKind];
  const selectedMode = getPermissionModeOption(value, resolvedAgentKind);

  return (
    <Dropdown
      value={selectedMode}
      items={modes}
      getItemKey={(mode) => mode.value}
      getItemLabel={(mode) => mode.label}
      onSelect={(mode) => onChange(mode.value)}
      leftIcon={Shield}
      width="13rem"
      itemClassName={styles['item-column']}
      dropdownPosition={dropdownPosition}
      disabled={disabled}
      compactOnMobile
      forceCompact={isSplitMode}
      triggerVariant={variant}
      dropdownAlign={dropdownAlign}
      renderItem={renderPermissionItem}
    />
  );
});

export interface PermissionModeSelectorProps extends PermissionModeControlProps {
  chatId?: string;
}

export const PermissionModeSelector = memo(function PermissionModeSelector({
  chatId,
  ...controlProps
}: PermissionModeSelectorProps) {
  const key = chatId ?? DEFAULT_CHAT_SETTINGS_KEY;
  const permissionMode = useChatSettingsStore(
    (state) => state.permissionModeByChat[key] ?? DEFAULT_PERMISSION_MODE,
  );

  return (
    <PermissionModeDropdown
      value={permissionMode}
      onChange={(mode) => useChatSettingsStore.getState().setPermissionMode(key, mode)}
      {...controlProps}
    />
  );
});
