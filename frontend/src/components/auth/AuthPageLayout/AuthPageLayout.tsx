import { memo, type ReactNode } from 'react';
import clsx from 'clsx';
import { Layout } from '@/components/layout/Layout/Layout';
import iconDark from '/assets/images/icon-dark.svg';
import iconLight from '/assets/images/icon-white.svg';
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
              {/* Theme-aware brand mark — dark glyph on light surfaces and vice versa,
                  matching the landing greeting and message avatars. */}
              <img
                src={iconDark}
                alt="Agentrove"
                className={clsx(styles.logo, styles['logo--on-light'])}
              />
              <img
                src={iconLight}
                alt="Agentrove"
                className={clsx(styles.logo, styles['logo--on-dark'])}
              />
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
