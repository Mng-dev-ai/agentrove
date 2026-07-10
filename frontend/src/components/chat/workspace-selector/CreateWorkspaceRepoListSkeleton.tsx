import clsx from 'clsx';
import styles from './CreateWorkspaceRepoListSkeleton.module.scss';

const SKELETON_ITEMS = [0, 1, 2];

export function CreateWorkspaceRepoListSkeleton() {
  return (
    <div className={styles['repo-list-skeleton']}>
      {SKELETON_ITEMS.map((i) => (
        <div key={i} className={styles.item}>
          <div className={styles.icon} />
          <div className={styles.content}>
            <div className={styles.line} />
            <div className={clsx(styles.line, styles['line--full'])} />
          </div>
        </div>
      ))}
    </div>
  );
}
