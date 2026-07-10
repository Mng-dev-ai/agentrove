import { memo, useCallback, useEffect, type Ref } from 'react';
import { Edit2, Trash2, Pin, PinOff, SplitSquareHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button/Button';
import type { Chat } from '@/types/chat.types';
import styles from './ChatDropdown.module.scss';

interface ChatDropdownProps {
  ref?: Ref<HTMLDivElement>;
  chat: Chat;
  position: { top: number; left: number };
  onRename: (chat: Chat) => void;
  onDelete: (chatId: string) => void;
  onTogglePin: (chat: Chat) => void;
  onOpenInSplit?: (chatId: string) => void;
  onClose?: () => void;
}

export const ChatDropdown = memo(function ChatDropdown({
  ref,
  chat,
  position,
  onRename,
  onDelete,
  onTogglePin,
  onOpenInSplit,
  onClose,
}: ChatDropdownProps) {
  const isPinned = !!chat.pinned_at;
  const isSubThread = !!chat.parent_chat_id;

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose?.();
      }
    },
    [onClose],
  );

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
      className={styles['chat-dropdown']}
      style={{
        top: `${position.top}px`,
        left: `${position.left}px`,
      }}
    >
      {!isSubThread && (
        <Button
          onClick={() => onTogglePin(chat)}
          role="menuitem"
          variant="unstyled"
          className={styles['menu-item']}
        >
          {isPinned ? (
            <>
              <PinOff className={styles.icon} />
              Unpin
            </>
          ) : (
            <>
              <Pin className={styles.icon} />
              Pin
            </>
          )}
        </Button>
      )}
      {onOpenInSplit && (
        <Button
          onClick={() => onOpenInSplit(chat.id)}
          role="menuitem"
          variant="unstyled"
          className={styles['menu-item']}
        >
          <SplitSquareHorizontal className={styles.icon} />
          Open in split
        </Button>
      )}
      <Button
        onClick={() => onRename(chat)}
        role="menuitem"
        variant="unstyled"
        className={styles['menu-item']}
      >
        <Edit2 className={styles.icon} />
        Rename
      </Button>
      <Button
        onClick={() => onDelete(chat.id)}
        role="menuitem"
        variant="unstyled"
        className={styles['menu-item-delete']}
      >
        <Trash2 className={styles.icon} />
        Delete
      </Button>
    </div>
  );
});
