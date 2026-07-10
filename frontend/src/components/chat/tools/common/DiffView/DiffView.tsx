import { memo, useMemo } from 'react';
import clsx from 'clsx';
import styles from './DiffView.module.scss';

function DiffLine({ line }: { line: string }) {
  const isAdded = line.startsWith('+') && !line.startsWith('+++');
  const isRemoved = line.startsWith('-') && !line.startsWith('---');
  const isHunkHeader =
    line.startsWith('@@') || line.startsWith('diff ') || line.startsWith('index ');
  const isFileHeader = line.startsWith('+++') || line.startsWith('---');

  if (isHunkHeader || isFileHeader) {
    return <div className={styles['header-line']}>{line}</div>;
  }

  return (
    <div className={styles.line}>
      <span
        className={clsx(
          styles.gutter,
          isRemoved && styles['gutter--removed'],
          isAdded && styles['gutter--added'],
        )}
      >
        {isRemoved ? '−' : isAdded ? '+' : ' '}
      </span>
      <span
        className={clsx(
          styles.content,
          isRemoved && styles['content--removed'],
          isAdded && styles['content--added'],
        )}
      >
        {line.slice(1) || ' '}
      </span>
    </div>
  );
}

export const DiffView = memo(function DiffView({ diff }: { diff: string }) {
  const lines = useMemo(() => diff.split('\n').filter((l) => l.length > 0), [diff]);
  return (
    <div className={styles.diff}>
      {lines.map((line, idx) => (
        <DiffLine key={idx} line={line} />
      ))}
    </div>
  );
});
