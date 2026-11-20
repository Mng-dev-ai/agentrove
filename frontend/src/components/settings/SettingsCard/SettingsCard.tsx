import clsx from 'clsx';
import styles from './SettingsCard.module.scss';

export function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className={styles['section-title']}>{title}</h2>
      <div className={styles['section-card']}>{children}</div>
    </section>
  );
}

interface SettingRowProps {
  title: string;
  desc?: string;
  className?: string;
  children: React.ReactNode;
}

export function SettingRow({ title, desc, className, children }: SettingRowProps) {
  return (
    <div className={clsx(styles['setting-row'], className)}>
      <div className={styles['setting-text']}>
        <h3 className={styles['setting-title']}>{title}</h3>
        {desc && <p className={styles['setting-desc']}>{desc}</p>}
      </div>
      {children}
    </div>
  );
}
