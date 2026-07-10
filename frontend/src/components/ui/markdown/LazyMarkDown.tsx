import { Suspense } from 'react';
import clsx from 'clsx';
import { lazyNamed } from '@/utils/lazyNamed';
import styles from './LazyMarkDown.module.scss';

const MarkDown = lazyNamed(() => import('./MarkDown'), 'MarkDown');

interface LazyMarkDownProps {
  content: string;
  className?: string;
  streaming?: boolean;
  highlightMentions?: boolean;
}

export function LazyMarkDown({
  content,
  className,
  streaming,
  highlightMentions,
}: LazyMarkDownProps) {
  return (
    <Suspense fallback={<div className={clsx(styles.fallback, className)}>{content}</div>}>
      <MarkDown
        content={content}
        className={className}
        streaming={streaming}
        highlightMentions={highlightMentions}
      />
    </Suspense>
  );
}
