import { memo, useState } from 'react';
import clsx from 'clsx';
import { BellRing, ChevronRight } from 'lucide-react';
import { MarkDown } from '@/components/ui/markdown/MarkDown';
import styles from './NoticeCard.module.scss';

export const NoticeCard = memo(function NoticeCard({ text }: { text: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div className={clsx(styles['notice-card'], !open && styles.collapsed)}>
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
      {open && <MarkDown content={text} />}
    </div>
  );
});
