import type { ReactNode } from 'react';
import styles from './AuthErrorBanner.module.scss';

interface AuthErrorBannerProps {
  children: ReactNode;
}

export function AuthErrorBanner({ children }: AuthErrorBannerProps) {
  return <div className={styles.banner}>{children}</div>;
}
