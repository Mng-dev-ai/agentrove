import type { ReactNode, Ref } from 'react';
import clsx from 'clsx';
import { Spinner } from '@/components/ui/primitives/Spinner/Spinner';
import { ScrollButton } from './ScrollButton';
import styles from './ConversationLayout.module.scss';

interface ConversationLayoutProps {
  children: ReactNode;
  composer: ReactNode;
  composerBanner?: ReactNode;
  corner?: ReactNode;
  showScrollButton: boolean;
  onScrollToBottom: () => void;
}

export function ConversationLayout({
  children,
  composer,
  composerBanner,
  corner,
  showScrollButton,
  onScrollToBottom,
}: ConversationLayoutProps) {
  return (
    <div className={styles.conversation}>
      <div className={clsx(styles.viewport, corner && styles['viewport--cornered'])}>
        {corner && <div className={styles.corner}>{corner}</div>}
        {children}
      </div>
      <div className={clsx(styles.composer, showScrollButton && styles['composer--scrolled'])}>
        {showScrollButton && <ScrollButton onClick={onScrollToBottom} />}
        <div className={styles['composer-surface']}>
          <div className={styles['composer-inner']}>
            {composerBanner}
            <div className={styles['input-slot']}>{composer}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

interface ConversationScrollerProps {
  ref: Ref<HTMLDivElement>;
  children: ReactNode;
}

export function ConversationScroller({ ref, children }: ConversationScrollerProps) {
  return (
    <div ref={ref} className={styles.scroller}>
      <div className={styles.content}>{children}</div>
    </div>
  );
}

export function ConversationColumn({ children }: { children: ReactNode }) {
  return <div className={styles.column}>{children}</div>;
}

export function ConversationOlderPages({
  hasNextPage,
  isFetchingNextPage,
}: {
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
}) {
  if (!hasNextPage) return null;
  return (
    <ConversationColumn>
      <div className={styles['list-header-row']}>
        {isFetchingNextPage && (
          <div className={styles['loading-more']}>
            <Spinner size="xs" />
            Loading older messages...
          </div>
        )}
      </div>
    </ConversationColumn>
  );
}
