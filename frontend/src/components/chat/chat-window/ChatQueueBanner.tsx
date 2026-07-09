import { memo } from 'react';
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
  if (messages.length === 0) {
    return null;
  }

  return (
    <div className={styles['queue-banner']}>
      <div className={styles['queue-card-list']}>
        {messages.map((pending) => (
          <QueueMessageCard
            key={pending.id}
            message={pending}
            onCancel={onCancel}
            onEdit={onEdit}
            onSendNow={onSendNow}
          />
        ))}
      </div>
    </div>
  );
});
