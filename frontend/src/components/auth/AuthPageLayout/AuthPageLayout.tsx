import { memo, type ReactNode } from 'react';
import { Layout } from '@/components/layout/Layout';
import styles from './AuthPageLayout.module.scss';

interface AuthPageLayoutProps {
  title: string;
  subtitle: string;
  children: ReactNode;
}

export const AuthPageLayout = memo(function AuthPageLayout({
  title,
  subtitle,
  children,
}: AuthPageLayoutProps) {
  return (
    <Layout isAuthPage={true}>
      <div className={styles.page}>
        <div className={styles.container}>
          <div className={styles.content}>
            <div className={styles.header}>
              <h2 className={styles.title}>{title}</h2>
              <p className={styles.subtitle}>{subtitle}</p>
            </div>

            <div className={styles.card}>{children}</div>
          </div>
        </div>
      </div>
    </Layout>
  );
});
