import { Spinner } from '@/components/ui/primitives/Spinner/Spinner';
import styles from './ViewLoadingFallback.module.scss';

export const viewLoadingFallback = (
  <div className={styles['view-loading-fallback']}>
    <Spinner size="md" className={styles.spinner} />
  </div>
);
