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
  const [dirtyKeys, setDirtyKeys] = useState<ReadonlySet<string>>(new Set());
  const [rescued, setRescued] = useState<LocalQueuedMessage[]>([]);
  const [prevMessages, setPrevMessages] = useState(messages);

  if (messages !== prevMessages) {
    setPrevMessages(messages);
    const remaining = new Set(messages.map((m) => m.key));
    const left = prevMessages.filter(
      (m) => m.synced && !remaining.has(m.key) && dirtyKeys.has(m.key),
    );
    if (left.length > 0) setRescued((current) => [...current, ...left]);
  }

  const handleDirtyChange = useCallback((key: string, dirty: boolean) => {
    setDirtyKeys((current) => {
      const next = new Set(current);
      if (dirty) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);

  const handleDiscard = useCallback((key: string) => {
    setRescued((current) => current.filter((m) => m.key !== key));
  }, []);

  if (messages.length === 0 && rescued.length === 0) {
    return null;
  }

  return (
    <div className={styles['queue-banner']}>
      <div className={styles['queue-card-list']}>
        {[...rescued, ...messages].map((pending) => (
          <QueueMessageCard
            key={pending.key}
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
