import { memo } from 'react';
import clsx from 'clsx';
import styles from './ChatSkeleton.module.scss';

export interface MessageSkeletonProps {
  className?: string;
}

export interface ChatSkeletonProps {
  messageCount?: number;
  className?: string;
}

const MessageSkeleton = memo(function MessageSkeleton({ className = '' }: MessageSkeletonProps) {
  return (
    <div className={clsx(styles['message-skeleton'], className)}>
      <div className={styles['skeleton-row']}>
        <div className={styles['avatar-slot']}>
          <div className={clsx(styles['pulse-block'], styles['avatar-circle'])} />
        </div>

        <div className={styles['skeleton-body']}>
          <div className={clsx(styles['pulse-block'], styles['name-bar'])} />

          <div className={styles.lines}>
            <div className={clsx(styles['pulse-block'], styles.line, styles['line--full'])} />
            <div
              className={clsx(styles['pulse-block'], styles.line, styles['line--four-fifths'])}
            />
            <div
              className={clsx(styles['pulse-block'], styles.line, styles['line--three-fifths'])}
            />
          </div>
        </div>
      </div>
    </div>
  );
});

export const ChatSkeleton = memo(function ChatSkeleton({
  messageCount = 3,
  className = '',
}: ChatSkeletonProps) {
  return (
    <div className={clsx(styles['chat-skeleton'], className)}>
      {Array.from({ length: messageCount }).map((_, index) => (
        <MessageSkeleton
          key={index}
          className={index === 0 ? styles['message-skeleton--first'] : ''}
        />
      ))}
    </div>
  );
});
