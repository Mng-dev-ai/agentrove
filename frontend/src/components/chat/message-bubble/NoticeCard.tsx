import { memo } from 'react';
import { BellRing } from 'lucide-react';
import { MarkDown } from '@/components/ui/markdown/MarkDown';
import styles from './NoticeCard.module.scss';

interface NoticeCardProps {
  text: string;
}

export const NoticeCard = memo(function NoticeCard({ text }: NoticeCardProps) {
  // Set apart from the assistant's own prose: the app wrote this, not the model.
  return (
    <div className={styles['notice-card']}>
      <div className={styles.badge}>
        <BellRing className={styles.icon} />
        <span>Automated update</span>
      </div>
      <MarkDown content={text} />
    </div>
  );
});
