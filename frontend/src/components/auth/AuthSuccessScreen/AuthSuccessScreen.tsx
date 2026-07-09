import { type ReactNode } from 'react';
import { CheckCircle } from 'lucide-react';
import { Layout } from '@/components/layout/Layout';
import { Button } from '@/components/ui/primitives/Button/Button';
import styles from './AuthSuccessScreen.module.scss';

interface AuthSuccessScreenProps {
  title: string;
  description: string;
  infoMessage?: string;
  buttonLabel: string;
  buttonIcon?: ReactNode;
  onButtonClick: () => void;
  footer?: string;
}

export function AuthSuccessScreen({
  title,
  description,
  infoMessage,
  buttonLabel,
  buttonIcon,
  onButtonClick,
  footer,
}: AuthSuccessScreenProps) {
  return (
    <Layout isAuthPage={true}>
      <div className={styles.page}>
        <div className={styles.container}>
          <div className={styles.content}>
            <div className={styles['icon-row']}>
              <CheckCircle className={styles['status-icon']} />
            </div>

            <div className={styles.card}>
              <div className={styles['card-header']}>
                <h2 className={styles.title}>{title}</h2>
                <p className={styles.description}>{description}</p>
              </div>

              {infoMessage && (
                <div className={styles['info-box']}>
                  <p className={styles['info-text']}>{infoMessage}</p>
                </div>
              )}

              <Button onClick={onButtonClick} variant="primary" size="lg" className={styles.action}>
                {buttonIcon}
                {buttonLabel}
              </Button>
            </div>

            {footer && <p className={styles.footer}>{footer}</p>}
          </div>
        </div>
      </div>
    </Layout>
  );
}
