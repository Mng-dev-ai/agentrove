import type { ReactNode } from 'react';
import clsx from 'clsx';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button/Button';
import { FloatingTooltip } from '@/components/ui/FloatingTooltip/FloatingTooltip';
import { stateClasses } from '@/config/stateClasses';
import styles from './TitleBarTab.module.scss';

export function TitleBarTabs({ children }: { children: ReactNode }) {
  return <div className={styles.tabs}>{children}</div>;
}

interface TitleBarTabActions {
  tooltip: string;
  isCurrent: boolean;
  onSelect: () => void;
  onClose: () => void;
}

interface TitleBarTabProps {
  icon: ReactNode;
  title: string;
  isActive: boolean;
  actions: TitleBarTabActions;
}

export function TitleBarTab({ icon, title, isActive, actions }: TitleBarTabProps) {
  return (
    <div
      // Middle-click closes (browser/editor tab convention).
      onAuxClick={(e) => {
        if (e.button === 1) actions.onClose();
      }}
      className={clsx(styles.tab, isActive && stateClasses.ACTIVE)}
    >
      <FloatingTooltip content={actions.tooltip} className={styles['tab-tooltip']}>
        <Button
          variant="unstyled"
          onClick={actions.onSelect}
          aria-current={actions.isCurrent ? 'page' : undefined}
          className={styles['tab-select']}
        >
          {icon}
          <span className={styles['tab-title']}>{title}</span>
        </Button>
      </FloatingTooltip>
      {/* Close stays focusable (opacity-0) so keyboard users can still reach it. */}
      <Button
        variant="unstyled"
        onClick={actions.onClose}
        className={styles['tab-close']}
        aria-label={`Close ${title} tab`}
      >
        <X className={styles['close-icon']} />
      </Button>
    </div>
  );
}
