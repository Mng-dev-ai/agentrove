import styles from './DialogError.module.scss';

interface DialogErrorProps {
  error: string | null;
  className?: string;
}

export function DialogError({ error, className = styles['dialog-error'] }: DialogErrorProps) {
  if (!error) return null;

  return (
    <div className={className}>
      <div className={styles.box}>
        <p className={styles.text}>{error}</p>
      </div>
    </div>
  );
}
