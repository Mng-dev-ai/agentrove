import type { ReactNode, Ref } from 'react';
import { ScrollButton } from './ScrollButton';
import styles from './ConversationLayout.module.scss';

interface ConversationLayoutProps {
  children: ReactNode;
  composer: ReactNode;
  composerBanner?: ReactNode;
  showScrollButton: boolean;
  onScrollToBottom: () => void;
}

export function ConversationLayout({
  children,
  composer,
  composerBanner,
  showScrollButton,
  onScrollToBottom,
}: ConversationLayoutProps) {
  return (
    <div className={styles.conversation}>
      <div className={styles.viewport}>{children}</div>
      <div className={styles.composer}>
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
