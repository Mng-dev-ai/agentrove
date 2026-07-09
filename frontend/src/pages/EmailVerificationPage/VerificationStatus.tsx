import { memo, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Mail, RefreshCw, AlertCircle, CheckCircle } from 'lucide-react';
import clsx from 'clsx';
import { Layout } from '@/components/layout/Layout';
import { Button } from '@/components/ui/primitives/Button/Button';
import styles from './VerificationStatus.module.scss';

export type VerificationState = 'pending' | 'verifying' | 'error' | 'success';

interface VerificationStatusProps {
  status: VerificationState;
  message: string;
  email: string;
  onResend: () => void;
  isResending: boolean;
}

export const VerificationStatus = memo(function VerificationStatus({
  status,
  message,
  email,
  onResend,
  isResending,
}: VerificationStatusProps) {
  const navigate = useNavigate();

  const { icon, heading, headingClassName, subText } = useMemo(() => {
    switch (status) {
      case 'error':
        return {
          icon: (
            <AlertCircle className={clsx(styles['status-icon'], styles['status-icon--error'])} />
          ),
          heading: 'Verification Failed',
          headingClassName: styles['heading--error'],
          subText: message,
        };
      case 'success':
        return {
          icon: (
            <CheckCircle className={clsx(styles['status-icon'], styles['status-icon--primary'])} />
          ),
          heading: 'Email Verified',
          headingClassName: styles['heading--primary'],
          subText: message || 'Your email has been verified successfully.',
        };
      case 'verifying':
        return {
          icon: <RefreshCw className={styles['status-icon--spinning']} />,
          heading: 'Verifying...',
          headingClassName: styles['heading--primary'],
          subText: 'Please wait while we verify your email...',
        };
      default:
        return {
          icon: <Mail className={clsx(styles['status-icon'], styles['status-icon--tertiary'])} />,
          heading: 'Check Your Email',
          headingClassName: styles['heading--primary'],
          subText: email
            ? `We sent a verification link to ${email}`
            : 'We sent a verification link to your email.',
        };
    }
  }, [email, message, status]);

  return (
    <Layout isAuthPage={true}>
      <div className={styles.page}>
        <div className={styles.container}>
          <div className={styles.content}>
            <div className={styles['icon-row']}>{icon}</div>

            <div className={styles.card}>
              <div className={styles['card-header']}>
                <h2 className={clsx(styles.heading, headingClassName)}>{heading}</h2>
                <p className={styles.subtext}>{subText}</p>
              </div>

              {status === 'success' && (
                <div className={styles['info-box']}>
                  <p className={styles['info-text']}>{message}</p>
                </div>
              )}

              <div className={styles.actions}>
                {(status === 'pending' || status === 'error') && (
                  <Button
                    onClick={onResend}
                    disabled={isResending}
                    variant="primary"
                    size="lg"
                    className={styles['full-width']}
                  >
                    {isResending ? (
                      <>
                        <RefreshCw className={styles['spinner-icon']} />
                        Sending...
                      </>
                    ) : (
                      <>
                        <Mail className={styles.icon} />
                        Resend Verification Email
                      </>
                    )}
                  </Button>
                )}

                {status === 'success' && (
                  <Button
                    onClick={() => navigate('/login')}
                    variant="primary"
                    size="lg"
                    className={styles['full-width']}
                  >
                    Continue to Login
                  </Button>
                )}

                {status !== 'verifying' && status !== 'success' && (
                  <Button
                    onClick={() => navigate('/login')}
                    variant="secondary"
                    size="lg"
                    className={styles['full-width']}
                  >
                    Back to Login
                  </Button>
                )}
              </div>
            </div>

            {status === 'pending' && (
              <div className={styles.footer}>
                <p>Can{'’'}t find the email? Check your spam folder.</p>
                <p>The verification link will expire in 24 hours.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
});
