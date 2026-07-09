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
import { AuthPageLayout } from '@/components/auth/AuthPageLayout';
import { AuthErrorBanner } from '@/components/auth/AuthErrorBanner';
import { AuthSuccessScreen } from '@/components/auth/AuthSuccessScreen';

interface ForgotPasswordFormData {
  email: string;
}

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
        buttonIcon={<ArrowLeft className="h-3.5 w-3.5" />}
        onButtonClick={() => navigate('/login')}
        footer="Can't find the email? Check your spam folder."
      />
    );
  }

  const title = 'Forgot Password';
  const subtitle = 'Enter your email to receive a reset link';

  return (
    <AuthPageLayout title={title} subtitle={subtitle}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {forgotPasswordMutation.error && (
          <AuthErrorBanner>
            <p className="text-xs font-medium text-error-600 dark:text-error-400">
              {forgotPasswordMutation.error.message.includes('contact@agentrove.pro') ? (
                <>
                  Email not found. Please check your email or contact support at{' '}
                  <Link
                    href="mailto:contact@agentrove.pro"
                    variant="unstyled"
                    className="underline transition-colors hover:text-error-500 dark:hover:text-error-300"
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

        <div className="space-y-3.5">
          <div className="space-y-1.5">
            <Label
              htmlFor="email"
              className="text-xs text-text-secondary dark:text-text-dark-secondary"
            >
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
          className="mt-5 w-full"
          isLoading={forgotPasswordMutation.isPending}
          loadingText="Sending..."
          loadingIcon={<Loader2 className="h-3.5 w-3.5 animate-spin" />}
        >
          <Mail className="h-3.5 w-3.5" />
          <span>Send Reset Link</span>
          <ArrowRight className="h-3.5 w-3.5" />
        </Button>
      </form>

      <div className="pt-4 text-center">
        <Button
          type="button"
          variant="link"
          className="inline-flex items-center gap-1 text-xs"
          onClick={() => navigate('/login')}
        >
          <ArrowLeft className="h-3 w-3" />
          Back to Sign in
        </Button>
      </div>
    </AuthPageLayout>
  );
}
