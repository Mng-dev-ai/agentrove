import { memo, useState } from 'react';
import clsx from 'clsx';
import { BellRing, ChevronRight } from 'lucide-react';
import { MarkDown } from '@/components/ui/markdown/MarkDown';
import styles from './NoticeCard.module.scss';

interface NoticeCardProps {
  text: string;
  // Starts closed behind its badge, for notices that only explain what triggered a turn.
  collapsible?: boolean;
}

export const NoticeCard = memo(function NoticeCard({ text, collapsible }: NoticeCardProps) {
  const [open, setOpen] = useState(false);
  const showBody = !collapsible || open;

  // Set apart from the assistant's own prose: the app wrote this, not the model.
  return (
    <div className={clsx(styles['notice-card'], !showBody && styles.collapsed)}>
      {collapsible ? (
        <button
          type="button"
          className={clsx(styles.badge, styles['badge-button'])}
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <BellRing className={styles.icon} />
          <span>Automated update</span>
          <ChevronRight className={clsx(styles.chevron, open && styles['chevron-open'])} />
        </button>
      ) : (
        <div className={styles.badge}>
          <BellRing className={styles.icon} />
          <span>Automated update</span>
        </div>
      )}
      {showBody && <MarkDown content={text} />}
    </div>
  );
});
