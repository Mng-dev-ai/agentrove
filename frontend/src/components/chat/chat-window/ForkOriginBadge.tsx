import clsx from 'clsx';
import { CornerDownRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/primitives/Button/Button';
import { FloatingTooltip } from '@/components/ui/FloatingTooltip/FloatingTooltip';
import { useChatQuery } from '@/hooks/queries/useChatQueries';
import styles from './ForkOriginBadge.module.scss';

interface ForkOriginBadgeProps {
  sourceChatId: string;
  sourceTitle: string;
  aboveComposer?: boolean;
}

export function ForkOriginBadge({
  sourceChatId,
  sourceTitle,
  aboveComposer = false,
}: ForkOriginBadgeProps) {
  const navigate = useNavigate();
  // A deleted source answers 404: the badge stays, without a way to open it.
  const { data: source } = useChatQuery(sourceChatId, { retry: false });

  return (
    <div className={clsx(styles.row, aboveComposer && styles['row--composer'])}>
      <div className={styles.badge}>
        <CornerDownRight className={styles.icon} />
        <span className={styles.label}>Forked from</span>
        {source ? (
          <FloatingTooltip content={`Open ${source.title}`} className={styles.tooltip}>
            <Button
              variant="unstyled"
              type="button"
              className={clsx(styles.title, styles['title-link'])}
              onClick={() => navigate(`/chat/${sourceChatId}`)}
            >
              {source.title}
            </Button>
          </FloatingTooltip>
        ) : (
          <span className={styles.title}>{sourceTitle}</span>
        )}
      </div>
    </div>
  );
}
