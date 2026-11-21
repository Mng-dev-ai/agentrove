import { useEffect, type KeyboardEvent, type ReactNode, type Ref } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button/Button';
import type { MenuPosition } from '@/store/uiStore';
import styles from './SidebarMenu.module.scss';

interface SidebarMenuProps {
  ref?: Ref<HTMLDivElement>;
  position: MenuPosition;
  onClose?: () => void;
  children: ReactNode;
}

export function SidebarMenu({ ref, position, onClose, children }: SidebarMenuProps) {
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose?.();
    }
  };

  useEffect(() => {
    const el = ref && typeof ref === 'object' && 'current' in ref ? ref.current : null;
    el?.focus();
  }, [ref]);

  return (
    <div
      ref={ref}
      role="menu"
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      className={styles.menu}
      style={{
        top: `${position.top}px`,
        ...('left' in position ? { left: `${position.left}px` } : { right: `${position.right}px` }),
      }}
    >
      {children}
    </div>
  );
}

interface SidebarMenuItemProps {
  icon: LucideIcon;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  children: ReactNode;
}

export function SidebarMenuItem({
  icon: Icon,
  onClick,
  danger = false,
  disabled,
  children,
}: SidebarMenuItemProps) {
  return (
    <Button
      onClick={onClick}
      role="menuitem"
      variant="unstyled"
      className={danger ? styles['item-danger'] : styles.item}
      disabled={disabled}
    >
      <Icon className={styles.icon} />
      {children}
    </Button>
  );
}
