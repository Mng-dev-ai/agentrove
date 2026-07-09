import { useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, ArrowLeft, Mail, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button/Button';
import { FieldMessage } from '@/components/ui/primitives/FieldMessage/FieldMessage';
import { Input } from '@/components/ui/primitives/Input/Input';
import { Label } from '@/components/ui/primitives/Label/Label';
import { Link } from '@/components/ui/primitives/Link/Link';
import { useForgotPasswordMutation } from '@/hooks/queries/useAuthQueries';
import { useAuthForm } from '@/hooks/useAuthForm';
import { isValidEmail } from '@/utils/validation';
import { AuthPageLayout } from '@/components/auth/AuthPageLayout/AuthPageLayout';
import { AuthErrorBanner } from '@/components/auth/AuthErrorBanner/AuthErrorBanner';
import { AuthSuccessScreen } from '@/components/auth/AuthSuccessScreen/AuthSuccessScreen';
import styles from './ForgotPasswordPage.module.scss';

type ForgotPasswordFormData = {
  email: string;
};

type ForgotPasswordFormErrors = Partial<Record<keyof ForgotPasswordFormData, string>>;

export function ForgotPasswordPage() {
  const navigate = useNavigate();

  const forgotPasswordMutation = useForgotPasswordMutation();

  const resetMutation = useCallback(() => {
    forgotPasswordMutation.reset();
  }, [forgotPasswordMutation]);

  const { values, errors, setErrors, handleChange } = useAuthForm<ForgotPasswordFormData>(
    { email: '' },
    resetMutation,
  );

  const validators = useMemo(
    () => ({
      email: (value: string): string | undefined => {
        const trimmed = value.trim();
        if (!trimmed) return 'Email is required';
        if (!isValidEmail(trimmed)) return 'Invalid email address';
        return undefined;
      },
    }),
    [],
  );

  const validateForm = useCallback(
    (data: ForgotPasswordFormData): ForgotPasswordFormErrors => {
      const nextErrors: ForgotPasswordFormErrors = {};
      (Object.keys(validators) as Array<keyof ForgotPasswordFormData>).forEach((key) => {
        const validator = validators[key];
        const error = validator(data[key]);
        if (error) {
          nextErrors[key] = error;
        }
      });
      return nextErrors;
    },
    [validators],
  );

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();

      const validationErrors = validateForm(values);
      if (Object.keys(validationErrors).length) {
        setErrors(validationErrors);
        return;
      }

      setErrors(null);
      forgotPasswordMutation.mutate({ email: values.email.trim() });
    },
    [forgotPasswordMutation, setErrors, validateForm, values],
  );

  if (forgotPasswordMutation.isSuccess) {
    return (
      <AuthSuccessScreen
        title="Check Your Email"
        description="We've sent a password reset link to your email"
        infoMessage="Check your email and follow the link to reset your password. The link will expire in 24 hours."
        buttonLabel="Back to Sign in"
        buttonIcon={<ArrowLeft className={styles.icon} />}
        onButtonClick={() => navigate('/login')}
        footer="Can't find the email? Check your spam folder."
      />
    );
  }

  const title = 'Forgot Password';
  const subtitle = 'Enter your email to receive a reset link';

  return (
    <AuthPageLayout title={title} subtitle={subtitle}>
      <form onSubmit={handleSubmit} className={styles.form}>
        {forgotPasswordMutation.error && (
          <AuthErrorBanner>
            <p className={styles['error-text']}>
              {forgotPasswordMutation.error.message.includes('contact@agentrove.pro') ? (
                <>
                  Email not found. Please check your email or contact support at{' '}
                  <Link
                    href="mailto:contact@agentrove.pro"
                    variant="unstyled"
                    className={styles['support-link']}
                  >
                    contact@agentrove.pro
                  </Link>
                </>
              ) : (
                forgotPasswordMutation.error.message
              )}
            </p>
          </AuthErrorBanner>
        )}

        <div className={styles.fields}>
          <div className={styles.field}>
            <Label htmlFor="email" className={styles.label}>
              Email address
            </Label>
            <Input
              id="email"
              type="email"
              value={values.email}
              onChange={(e) => handleChange('email', e.target.value)}
              placeholder="name@example.com"
              hasError={Boolean(errors?.email)}
            />
            <FieldMessage variant="error">{errors?.email}</FieldMessage>
          </div>
        </div>

        <Button
          type="submit"
          variant="primary"
          size="lg"
          className={styles.submit}
          isLoading={forgotPasswordMutation.isPending}
          loadingText="Sending..."
          loadingIcon={<Loader2 className={styles['spinner-icon']} />}
        >
          <Mail className={styles.icon} />
          <span>Send Reset Link</span>
          <ArrowRight className={styles.icon} />
        </Button>
      </form>

      <div className={styles.footer}>
        <Button
          type="button"
          variant="link"
          className={styles['back-link']}
          onClick={() => navigate('/login')}
        >
          <ArrowLeft className={styles['icon-sm']} />
          Back to Sign in
        </Button>
      </div>
    </AuthPageLayout>
  );
}
