import { useState, useCallback, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Loader2, ArrowLeft, Lock, ArrowRight, Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button/Button';
import { FieldMessage } from '@/components/ui/primitives/FieldMessage/FieldMessage';
import { Input } from '@/components/ui/primitives/Input/Input';
import { Label } from '@/components/ui/primitives/Label/Label';
import { useResetPasswordMutation } from '@/hooks/queries/useAuthQueries';
import { useAuthForm } from '@/hooks/useAuthForm';
import { isValidPassword } from '@/utils/validation';
import { AuthPageLayout } from '@/components/auth/AuthPageLayout/AuthPageLayout';
import { AuthErrorBanner } from '@/components/auth/AuthErrorBanner/AuthErrorBanner';
import { AuthSuccessScreen } from '@/components/auth/AuthSuccessScreen/AuthSuccessScreen';
import styles from './ResetPasswordPage.module.scss';

type ResetPasswordFormData = {
  password: string;
  confirmPassword: string;
};

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
        buttonIcon={<ArrowRight className={styles.icon} />}
        onButtonClick={() => navigate('/login')}
      />
    );
  }

  const title = 'Reset Password';
  const subtitle = 'Enter your new password';

  return (
    <AuthPageLayout title={title} subtitle={subtitle}>
      <form onSubmit={handleSubmit} className={styles.form}>
        {(tokenError || resetPasswordMutation.error) && (
          <AuthErrorBanner>
            <p className={styles['error-text']}>
              {tokenError || resetPasswordMutation.error?.message}
            </p>
            {(tokenError?.includes('token') ||
              resetPasswordMutation.error?.message?.includes('token')) && (
              <div className={styles['error-cta']}>
                <Button
                  type="button"
                  variant="link"
                  className={styles['error-link']}
                  onClick={() => navigate('/forgot-password')}
                >
                  Request a new reset link
                </Button>
              </div>
            )}
          </AuthErrorBanner>
        )}

        <div className={styles.fields}>
          {fieldConfigs.map(({ name, label, placeholder }) => (
            <div key={name} className={styles.field}>
              <Label htmlFor={name} className={styles.label}>
                {label}
              </Label>
              <div className={styles['password-field']}>
                <Input
                  id={name}
                  type={visibleFields[name] ? 'text' : 'password'}
                  value={values[name]}
                  onChange={(e) => handleChange(name, e.target.value)}
                  placeholder={placeholder}
                  autoComplete="new-password"
                  hasError={Boolean(errors?.[name])}
                  className={styles['password-input']}
                />
                <Button
                  type="button"
                  onClick={() => toggleFieldVisibility(name)}
                  variant="ghost"
                  size="icon"
                  className={styles['password-toggle']}
                  aria-label="Toggle password visibility"
                >
                  {visibleFields[name] ? (
                    <EyeOff className={styles.icon} />
                  ) : (
                    <Eye className={styles.icon} />
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
          className={styles.submit}
          isLoading={isSubmitting}
          loadingText="Resetting..."
          loadingIcon={<Loader2 className={styles['spinner-icon']} />}
          disabled={!token || isSubmitting}
        >
          <Lock className={styles.icon} />
          <span>Reset Password</span>
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
