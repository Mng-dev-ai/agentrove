import { type CSSProperties } from 'react';
import styles from './SearchLoadingDots.module.scss';

const DELAY_0: CSSProperties = { animationDelay: '0ms' };
const DELAY_150: CSSProperties = { animationDelay: '150ms' };
const DELAY_300: CSSProperties = { animationDelay: '300ms' };

interface SearchLoadingDotsProps {
  label: string;
}

export function SearchLoadingDots({ label }: SearchLoadingDotsProps) {
  return (
    <div className={styles.dots}>
      <div className={styles.track}>
        <div className={styles.dot} style={DELAY_0} />
        <div className={styles.dot} style={DELAY_150} />
        <div className={styles.dot} style={DELAY_300} />
      </div>
      <p className={styles.label}>{label}</p>
    </div>
  );
}
