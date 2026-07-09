import { memo, useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Mail, RefreshCw, AlertCircle, CheckCircle } from 'lucide-react';
import { Layout } from '@/components/layout/Layout';
import { Button } from '@/components/ui/primitives/Button/Button';
import {
  useVerifyEmailMutation,
  useResendVerificationMutation,
} from '@/hooks/queries/useAuthQueries';
import { useAuthStore } from '@/store/authStore';
import { cn } from '@/utils/cn';

type VerificationState = 'pending' | 'verifying' | 'error' | 'success';

interface VerificationStatusProps {
  status: VerificationState;
  message: string;
  email: string;
  onResend: () => void;
  isResending: boolean;
}

const VerificationStatus = memo(function VerificationStatus({
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
          icon: <AlertCircle className="h-6 w-6 text-error-500 dark:text-error-400" />,
          heading: 'Verification Failed',
          headingClassName: 'text-error-600 dark:text-error-400',
          subText: message,
        };
      case 'success':
        return {
          icon: <CheckCircle className="h-6 w-6 text-text-primary dark:text-text-dark-primary" />,
          heading: 'Email Verified',
          headingClassName: 'text-text-primary dark:text-text-dark-primary',
          subText: message || 'Your email has been verified successfully.',
        };
      case 'verifying':
        return {
          icon: (
            <RefreshCw className="h-5 w-5 animate-spin text-text-tertiary dark:text-text-dark-tertiary" />
          ),
          heading: 'Verifying...',
          headingClassName: 'text-text-primary dark:text-text-dark-primary',
          subText: 'Please wait while we verify your email...',
        };
      default:
        return {
          icon: <Mail className="h-6 w-6 text-text-tertiary dark:text-text-dark-tertiary" />,
          heading: 'Check Your Email',
          headingClassName: 'text-text-primary dark:text-text-dark-primary',
          subText: email
            ? `We sent a verification link to ${email}`
            : 'We sent a verification link to your email.',
        };
    }
  }, [email, message, status]);

  return (
    <Layout isAuthPage={true}>
      <div className="flex h-full flex-col bg-surface-secondary dark:bg-surface-dark-secondary">
        <div className="flex flex-1 flex-col items-center justify-center p-4">
          <div className="relative z-10 w-full max-w-sm space-y-5">
            <div className="flex justify-center">{icon}</div>

            <div className="rounded-xl border border-border/50 bg-surface-tertiary p-6 shadow-medium dark:border-border-dark/50 dark:bg-surface-dark-tertiary">
              <div className="mb-5 space-y-1.5 text-center">
                <h2 className={cn('text-lg font-semibold', headingClassName)}>{heading}</h2>
                <p className="text-xs text-text-tertiary dark:text-text-dark-tertiary">{subText}</p>
              </div>

              {status === 'success' && (
                <div className="mb-5 rounded-lg border border-border/50 bg-surface-hover/50 p-3 dark:border-border-dark/50 dark:bg-surface-dark-hover/50">
                  <p className="text-xs text-text-secondary dark:text-text-dark-secondary">
                    {message}
                  </p>
                </div>
              )}

              <div className="space-y-3">
                {(status === 'pending' || status === 'error') && (
                  <Button
                    onClick={onResend}
                    disabled={isResending}
                    variant="primary"
                    size="lg"
                    className="w-full"
                  >
                    {isResending ? (
                      <>
                        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                        Sending...
                      </>
                    ) : (
                      <>
                        <Mail className="h-3.5 w-3.5" />
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
                    className="w-full"
                  >
                    Continue to Login
                  </Button>
                )}

                {status !== 'verifying' && status !== 'success' && (
                  <Button
                    onClick={() => navigate('/login')}
                    variant="secondary"
                    size="lg"
                    className="w-full"
                  >
                    Back to Login
                  </Button>
                )}
              </div>
            </div>

            {status === 'pending' && (
              <div className="space-y-0.5 text-center text-2xs text-text-quaternary dark:text-text-dark-quaternary">
                <p>Can{'\u2019'}t find the email? Check your spam folder.</p>
                <p>The verification link will expire in 24 hours.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
});

export function EmailVerificationPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState<VerificationState>('pending');
  const [message, setMessage] = useState('');
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const verificationAttempted = useRef(false);

  const query = useMemo(() => {
    let email = searchParams.get('email')?.trim() ?? '';
    if (!email) {
      email = sessionStorage.getItem('pending_verification_email') ?? '';
    }
    return {
      email,
      verificationToken: searchParams.get('token'),
      alreadyVerified: searchParams.get('already_verified'),
      verificationFailed: searchParams.get('verification_failed'),
    };
  }, [searchParams]);

  const verifyEmailMutation = useVerifyEmailMutation({
    onSuccess: () => {
      sessionStorage.removeItem('pending_verification_email');
      setStatus('success');
      setMessage('Your email has been verified successfully. You can now log in.');
    },
    onError: (error) => {
      setStatus('error');
      setMessage(error.message || 'Verification failed. Please try again.');
    },
  });

  const resendMutation = useResendVerificationMutation({
    onSuccess: () => {
      setMessage('Verification email sent! Please check your inbox.');
      setStatus('pending');
    },
    onError: (error) => {
      setMessage(error.message || 'Failed to resend email. Please try again.');
      setStatus('error');
    },
  });

  useEffect(() => {
    if (isAuthenticated) {
      navigate('/');
    }
  }, [isAuthenticated, navigate]);

  useEffect(() => {
    if (query.alreadyVerified === 'true') {
      navigate('/login');
    } else if (query.verificationFailed) {
      setStatus('error');
      if (query.verificationFailed === 'invalid_token') {
        setMessage('Invalid verification link. Please request a new one.');
      } else if (query.verificationFailed === 'expired_token') {
        setMessage('Verification link has expired. Please request a new one.');
      }
    }
  }, [navigate, query.alreadyVerified, query.verificationFailed]);

  useEffect(() => {
    if (query.verificationToken && status === 'pending' && !verificationAttempted.current) {
      verificationAttempted.current = true;
      setStatus('verifying');
      verifyEmailMutation.mutate({ token: query.verificationToken });
    }
  }, [query.verificationToken, status, verifyEmailMutation]);

  useEffect(() => {
    const hasContext =
      Boolean(query.email) ||
      Boolean(query.verificationToken) ||
      Boolean(query.verificationFailed) ||
      query.alreadyVerified === 'true';

    if (!hasContext) {
      navigate('/login');
    }
  }, [
    navigate,
    query.alreadyVerified,
    query.email,
    query.verificationFailed,
    query.verificationToken,
  ]);

  const handleResend = useCallback(() => {
    if (!query.email) return;
    setMessage('');
    setStatus('pending');
    resendMutation.mutate({ email: query.email });
  }, [query.email, resendMutation]);

  return (
    <VerificationStatus
      status={status}
      message={message}
      email={query.email}
      onResend={handleResend}
      isResending={resendMutation.isPending}
    />
  );
}
