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
  children: React.ReactNode;
}

export function SettingRow({ title, desc, children }: SettingRowProps) {
  return (
    <div className={styles['setting-row']}>
      <div className={styles['setting-text']}>
        <h3 className={styles['setting-title']}>{title}</h3>
        {desc && <p className={styles['setting-desc']}>{desc}</p>}
      </div>
      {children}
    </div>
  );
}
