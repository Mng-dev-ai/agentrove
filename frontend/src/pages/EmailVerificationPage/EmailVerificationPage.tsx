import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  useVerifyEmailMutation,
  useResendVerificationMutation,
} from '@/hooks/queries/useAuthQueries';
import { useAuthStore } from '@/store/authStore';
import { VerificationStatus, type VerificationState } from './VerificationStatus';

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
