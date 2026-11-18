import { memo, useCallback, useState } from 'react';
import { QueueMessageCard } from './QueueMessageCard';
import type { LocalQueuedMessage } from '@/types/queue.types';
import styles from './ChatQueueBanner.module.scss';

interface ChatQueueBannerProps {
  messages: LocalQueuedMessage[];
  onCancel: (messageId: string) => void;
  onEdit: (messageId: string, newContent: string) => void;
  onSendNow: (messageId: string) => void;
}

export const ChatQueueBanner = memo(function ChatQueueBanner({
  messages,
  onCancel,
  onEdit,
  onSendNow,
}: ChatQueueBannerProps) {
  const [dirtyIds, setDirtyIds] = useState<ReadonlySet<string>>(new Set());
  const [rescued, setRescued] = useState<LocalQueuedMessage[]>([]);
  const [prevMessages, setPrevMessages] = useState(messages);

  if (messages !== prevMessages) {
    setPrevMessages(messages);
    const remaining = new Set(messages.map((m) => m.id));
    const left = prevMessages.filter((m) => !remaining.has(m.id) && dirtyIds.has(m.id));
    if (left.length > 0) setRescued((current) => [...current, ...left]);
  }

  const handleDirtyChange = useCallback((messageId: string, dirty: boolean) => {
    setDirtyIds((current) => {
      const next = new Set(current);
      if (dirty) next.add(messageId);
      else next.delete(messageId);
      return next;
    });
  }, []);

  const handleDiscard = useCallback((messageId: string) => {
    setRescued((current) => current.filter((m) => m.id !== messageId));
  }, []);

  if (messages.length === 0 && rescued.length === 0) {
    return null;
  }

  return (
    <div className={styles['queue-banner']}>
      <div className={styles['queue-card-list']}>
        {[...rescued, ...messages].map((pending) => (
          <QueueMessageCard
            key={pending.id}
            message={pending}
            onCancel={onCancel}
            onEdit={onEdit}
            onSendNow={onSendNow}
            rescued={rescued.includes(pending)}
            onDirtyChange={handleDirtyChange}
            onDiscard={handleDiscard}
          />
        ))}
      </div>
    </div>
  );
});
