import { memo, useCallback, useEffect, type Ref } from 'react';
import { Edit2, Trash2, Pin, PinOff, SplitSquareHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button/Button';
import { cn } from '@/utils/cn';
import type { Chat } from '@/types/chat.types';

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
      className={cn(
        'fixed w-32',
        'bg-surface dark:bg-surface-dark',
        'border border-border dark:border-border-dark',
        'z-50 overflow-hidden rounded-lg shadow-medium focus:outline-none',
      )}
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
          className={cn(
            'w-full px-3 py-2 text-left text-xs',
            'text-text-primary dark:text-text-dark-primary',
            'hover:bg-surface-hover dark:hover:bg-surface-dark-hover',
            'flex items-center gap-2 transition-colors',
          )}
        >
          {isPinned ? (
            <>
              <PinOff className="h-3 w-3" />
              Unpin
            </>
          ) : (
            <>
              <Pin className="h-3 w-3" />
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
          className={cn(
            'w-full px-3 py-2 text-left text-xs',
            'text-text-primary dark:text-text-dark-primary',
            'hover:bg-surface-hover dark:hover:bg-surface-dark-hover',
            'flex items-center gap-2 transition-colors',
          )}
        >
          <SplitSquareHorizontal className="h-3 w-3" />
          Open in split
        </Button>
      )}
      <Button
        onClick={() => onRename(chat)}
        role="menuitem"
        variant="unstyled"
        className={cn(
          'w-full px-3 py-2 text-left text-xs',
          'text-text-primary dark:text-text-dark-primary',
          'hover:bg-surface-hover dark:hover:bg-surface-dark-hover',
          'flex items-center gap-2 transition-colors',
        )}
      >
        <Edit2 className="h-3 w-3" />
        Rename
      </Button>
      <Button
        onClick={() => onDelete(chat.id)}
        role="menuitem"
        variant="unstyled"
        className={cn(
          'w-full px-3 py-2 text-left text-xs',
          'text-error-600 dark:text-error-400',
          'hover:bg-error-50 dark:hover:bg-error-900/20',
          'flex items-center gap-2 transition-colors',
        )}
      >
        <Trash2 className="h-3 w-3" />
        Delete
      </Button>
    </div>
  );
});
