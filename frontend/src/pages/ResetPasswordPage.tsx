import { useState, useCallback, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Lock, ArrowRight, Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button/Button';
import { FieldMessage } from '@/components/ui/primitives/FieldMessage/FieldMessage';
import { Input } from '@/components/ui/primitives/Input/Input';
import { Label } from '@/components/ui/primitives/Label/Label';
import { useResetPasswordMutation } from '@/hooks/queries/useAuthQueries';
import { useAuthForm } from '@/hooks/useAuthForm';
import { isValidPassword } from '@/utils/validation';
import { AuthPageLayout } from '@/components/auth/AuthPageLayout';
import { AuthErrorBanner } from '@/components/auth/AuthErrorBanner';
import { AuthSuccessScreen } from '@/components/auth/AuthSuccessScreen';

interface ResetPasswordFormData {
  password: string;
  confirmPassword: string;
}

type ResetPasswordFormErrors = Partial<Record<keyof ResetPasswordFormData, string>>;

const validateForm = (values: ResetPasswordFormData): ResetPasswordFormErrors | null => {
  const errors: ResetPasswordFormErrors = {};

  if (!values.password) {
    errors.password = 'Password is required';
  } else if (!isValidPassword(values.password)) {
    errors.password = 'Password must be at least 8 characters';
  }

  if (!values.confirmPassword) {
    errors.confirmPassword = 'Please confirm your password';
  } else if (values.password !== values.confirmPassword) {
    errors.confirmPassword = 'Passwords do not match';
  }

  return Object.keys(errors).length ? errors : null;
};

export function ResetPasswordPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [visibleFields, setVisibleFields] = useState<Record<keyof ResetPasswordFormData, boolean>>({
    password: false,
    confirmPassword: false,
  });
  // The reset token is fully owned by the URL, so deriving it avoids a mount-only sync effect
  // and keeps the invalid-token state tied to the actual query string.
  const token = searchParams.get('token');
  const tokenError = token ? null : 'Invalid or missing reset token';

  const resetPasswordMutation = useResetPasswordMutation();

  const resetMutation = useCallback(() => {
    resetPasswordMutation.reset();
  }, [resetPasswordMutation]);

  const { values, errors, setErrors, handleChange } = useAuthForm<ResetPasswordFormData>(
    { password: '', confirmPassword: '' },
    resetMutation,
  );

  const toggleFieldVisibility = useCallback((field: keyof ResetPasswordFormData) => {
    setVisibleFields((prev) => ({ ...prev, [field]: !prev[field] }));
  }, []);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();

      if (!token) {
        return;
      }

      const validationErrors = validateForm(values);
      if (validationErrors) {
        setErrors(validationErrors);
        return;
      }

      setErrors(null);
      const attemptValues = { ...values };

      resetPasswordMutation.mutate({
        token,
        password: attemptValues.password,
      });
    },
    [resetPasswordMutation, setErrors, token, values],
  );

  const fieldConfigs = useMemo(
    () => [
      {
        name: 'password' as const,
        label: 'New Password',
        placeholder: 'Enter new password (min. 8 characters)',
      },
      {
        name: 'confirmPassword' as const,
        label: 'Confirm Password',
        placeholder: 'Confirm your new password',
      },
    ],
    [],
  );

  const isSubmitting = resetPasswordMutation.isPending;

  if (resetPasswordMutation.isSuccess) {
    return (
      <AuthSuccessScreen
        title="Password Reset"
        description="Your password has been updated"
        infoMessage="Password has been reset successfully! You can now log in with your new password."
        buttonLabel="Sign In"
        buttonIcon={<ArrowRight className="h-3.5 w-3.5" />}
        onButtonClick={() => navigate('/login')}
      />
    );
  }

  const title = 'Reset Password';
  const subtitle = 'Enter your new password';

  return (
    <AuthPageLayout title={title} subtitle={subtitle}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {(tokenError || resetPasswordMutation.error) && (
          <AuthErrorBanner>
            <p className="text-xs font-medium text-error-600 dark:text-error-400">
              {tokenError || resetPasswordMutation.error?.message}
            </p>
            {(tokenError?.includes('token') ||
              resetPasswordMutation.error?.message?.includes('token')) && (
              <div className="mt-2">
                <Button
                  type="button"
                  variant="link"
                  className="text-xs text-error-600 hover:text-error-500 dark:text-error-400 dark:hover:text-error-300"
                  onClick={() => navigate('/forgot-password')}
                >
                  Request a new reset link
                </Button>
              </div>
            )}
          </AuthErrorBanner>
        )}

        <div className="space-y-3.5">
          {fieldConfigs.map(({ name, label, placeholder }) => (
            <div key={name} className="space-y-1.5">
              <Label
                htmlFor={name}
                className="text-xs text-text-secondary dark:text-text-dark-secondary"
              >
                {label}
              </Label>
              <div className="relative">
                <Input
                  id={name}
                  type={visibleFields[name] ? 'text' : 'password'}
                  value={values[name]}
                  onChange={(e) => handleChange(name, e.target.value)}
                  placeholder={placeholder}
                  autoComplete="new-password"
                  hasError={Boolean(errors?.[name])}
                  className="pr-10"
                />
                <Button
                  type="button"
                  onClick={() => toggleFieldVisibility(name)}
                  variant="ghost"
                  size="icon"
                  className="absolute right-1.5 top-1/2 h-7 w-7 -translate-y-1/2 text-text-quaternary hover:text-text-secondary dark:text-text-dark-quaternary dark:hover:text-text-dark-secondary"
                  aria-label="Toggle password visibility"
                >
                  {visibleFields[name] ? (
                    <EyeOff className="h-3.5 w-3.5" />
                  ) : (
                    <Eye className="h-3.5 w-3.5" />
                  )}
                </Button>
              </div>
              <FieldMessage variant="error">{errors?.[name]}</FieldMessage>
            </div>
          ))}
        </div>

        <Button
          type="submit"
          variant="primary"
          size="lg"
          className="mt-5 w-full"
          isLoading={isSubmitting}
          loadingText="Resetting..."
          loadingIcon={<Loader2 className="h-3.5 w-3.5 animate-spin" />}
          disabled={!token || isSubmitting}
        >
          <Lock className="h-3.5 w-3.5" />
          <span>Reset Password</span>
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
