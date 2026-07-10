import { memo } from 'react';
import clsx from 'clsx';
import { Shield } from 'lucide-react';
import { Dropdown } from '@/components/ui/primitives/Dropdown/Dropdown';
import { Button } from '@/components/ui/primitives/Button/Button';
import { useIsSplitMode } from '@/hooks/useIsSplitMode';
import {
  useChatSettingsStore,
  DEFAULT_CHAT_SETTINGS_KEY,
  DEFAULT_PERMISSION_MODE,
  DEFAULT_PLAN_MODE,
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

export interface PermissionModeSelectorProps {
  chatId?: string;
  agentKind?: AgentKind;
  dropdownPosition?: 'top' | 'bottom';
  disabled?: boolean;
  variant?: 'default' | 'text';
  dropdownAlign?: 'left' | 'right';
}

export const PermissionModeSelector = memo(function PermissionModeSelector({
  chatId,
  agentKind,
  dropdownPosition = 'bottom',
  dropdownAlign,
  disabled = false,
  variant = 'default',
}: PermissionModeSelectorProps) {
  const resolvedAgentKind = agentKind ?? 'claude';
  const showPlanMode = resolvedAgentKind === 'codex';
  const key = chatId ?? DEFAULT_CHAT_SETTINGS_KEY;
  const permissionMode = useChatSettingsStore(
    (state) => state.permissionModeByChat[key] ?? DEFAULT_PERMISSION_MODE,
  );
  // Only subscribe to planMode changes for Codex — Claude never uses it
  const planMode = useChatSettingsStore((state) =>
    showPlanMode ? (state.planModeByChat[key] ?? DEFAULT_PLAN_MODE) : false,
  );
  const isSplitMode = useIsSplitMode();

  const modes = MODES_BY_AGENT[resolvedAgentKind];
  const selectedMode = getPermissionModeOption(permissionMode, resolvedAgentKind);

  const shortLabelFn = showPlanMode
    ? (mode: PermissionModeOption) => (planMode ? `${mode.label} (Plan)` : mode.label)
    : undefined;

  return (
    <Dropdown
      value={selectedMode}
      items={modes}
      getItemKey={(mode) => mode.value}
      getItemLabel={(mode) => mode.label}
      getItemShortLabel={shortLabelFn}
      onSelect={(mode) => useChatSettingsStore.getState().setPermissionMode(key, mode.value)}
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
      renderFooter={
        showPlanMode
          ? () => (
              <div className={styles.footer}>
                <Button
                  type="button"
                  variant="unstyled"
                  onClick={() => {
                    useChatSettingsStore.getState().setPlanMode(key, !planMode);
                  }}
                  className={styles['plan-toggle']}
                >
                  <div className={styles['plan-toggle-spacer']} />
                  <div className={styles['plan-toggle-text']}>
                    <span
                      className={clsx(
                        styles['plan-toggle-label'],
                        planMode && styles['plan-toggle-label--active'],
                      )}
                    >
                      Plan Mode
                    </span>
                    <span className={styles['mode-description']}>
                      Review steps before executing
                    </span>
                  </div>
                  <div
                    className={clsx(styles['mode-toggle'], planMode && styles['mode-toggle--on'])}
                  >
                    <div
                      className={clsx(
                        styles['mode-toggle-thumb'],
                        planMode && styles['mode-toggle-thumb--on'],
                      )}
                    />
                  </div>
                </Button>
              </div>
            )
          : undefined
      }
    />
  );
});
