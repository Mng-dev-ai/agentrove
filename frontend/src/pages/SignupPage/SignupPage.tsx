import { useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button/Button';
import { FieldMessage } from '@/components/ui/primitives/FieldMessage/FieldMessage';
import { Input } from '@/components/ui/primitives/Input/Input';
import { Label } from '@/components/ui/primitives/Label/Label';
import { useSignupMutation } from '@/hooks/queries/useAuthQueries';
import { useAuthForm } from '@/hooks/useAuthForm';
import { isValidEmail, isValidUsername, isValidPassword } from '@/utils/validation';
import { useAuthStore } from '@/store/authStore';
import { authService } from '@/services/authService';
import { AuthPageLayout } from '@/components/auth/AuthPageLayout/AuthPageLayout';
import { AuthErrorBanner } from '@/components/auth/AuthErrorBanner/AuthErrorBanner';
import styles from './SignupPage.module.scss';

type SignupFormData = {
  email: string;
  username: string;
  password: string;
  confirmPassword: string;
};

type SignupFormErrors = Partial<Record<keyof SignupFormData, string>>;

const validateForm = (values: SignupFormData): SignupFormErrors | null => {
  const errors: SignupFormErrors = {};

  if (!values.email) {
    errors.email = 'Email is required';
  } else if (!isValidEmail(values.email)) {
    errors.email = 'Invalid email address';
  }

  if (!values.username) {
    errors.username = 'Username is required';
  } else if (!isValidUsername(values.username)) {
    errors.username =
      'Username must be 3-30 characters, contain only letters, numbers, and underscores, and cannot start or end with underscore';
  }

  if (!values.password) {
    errors.password = 'Password is required';
  } else if (!isValidPassword(values.password)) {
    errors.password = 'Password must be at least 8 characters';
  }

  if (!values.confirmPassword) {
    errors.confirmPassword = 'Please confirm your password';
  } else if (values.confirmPassword !== values.password) {
    errors.confirmPassword = 'Passwords do not match';
  }

  return Object.keys(errors).length ? errors : null;
};

export function SignupPage() {
  const navigate = useNavigate();

  const signupMutation = useSignupMutation({
    onSuccess: (user) => {
      const needsVerification = user.email_verification_required && !user.is_verified;
      if (!needsVerification && authService.isAuthenticated()) {
        useAuthStore.getState().setAuthenticated(true);
        navigate('/');
      } else {
        navigate(`/verify-email?email=${encodeURIComponent(user.email)}`);
      }
    },
  });

  const { values, errors, setErrors, handleChange } = useAuthForm<SignupFormData>({
    email: '',
    username: '',
    password: '',
    confirmPassword: '',
  });

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();

      const validationErrors = validateForm(values);
      if (validationErrors) {
        setErrors(validationErrors);
        return;
      }

      setErrors(null);
      const attemptValues = { ...values };
      const signupData: Omit<SignupFormData, 'confirmPassword'> = {
        email: attemptValues.email,
        username: attemptValues.username,
        password: attemptValues.password,
      };
      signupMutation.mutate(signupData);
    },
    [setErrors, signupMutation, values],
  );

  const title = 'Join Agentrove';
  const subtitle = 'Create your agentrove account';

  const isSubmitting = signupMutation.isPending;
  const error = signupMutation.error?.message;

  const fieldConfigs = useMemo<
    Array<{
      name: keyof SignupFormData;
      label: string;
      placeholder: string;
      type: 'email' | 'text' | 'password';
      helperText?: string;
    }>
  >(
    () => [
      {
        name: 'email',
        label: 'Email address',
        placeholder: 'name@example.com',
        type: 'email',
      },
      {
        name: 'username',
        label: 'Username',
        placeholder: 'your_username',
        type: 'text',
        helperText:
          '3-30 characters. Letters, numbers, and underscores only. Cannot start or end with an underscore.',
      },
      {
        name: 'password',
        label: 'Password',
        placeholder: 'Enter your password',
        type: 'password',
      },
      {
        name: 'confirmPassword',
        label: 'Confirm Password',
        placeholder: 'Confirm your password',
        type: 'password',
      },
    ],
    [],
  );

  return (
    <AuthPageLayout title={title} subtitle={subtitle}>
      <form onSubmit={handleSubmit} className={styles.form}>
        {error && (
          <AuthErrorBanner>
            <p className={styles['error-text']}>{error}</p>
          </AuthErrorBanner>
        )}

        <div className={styles.fields}>
          {fieldConfigs.map(({ name, label, placeholder, type, helperText }) => (
            <div key={name} className={styles.field}>
              <Label htmlFor={name} className={styles.label}>
                {label}
              </Label>
              <Input
                id={name}
                type={type}
                value={values[name]}
                onChange={(e) => handleChange(name, e.target.value)}
                placeholder={placeholder}
                autoComplete={
                  name === 'email'
                    ? 'email'
                    : name === 'username'
                      ? 'username'
                      : name === 'password'
                        ? 'new-password'
                        : 'new-password'
                }
                hasError={Boolean(errors?.[name])}
              />
              <FieldMessage>{helperText}</FieldMessage>
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
          loadingText="Creating account..."
          loadingIcon={<Loader2 className={styles['spinner-icon']} />}
        >
          <span>Get Started</span>
          <ArrowRight className={styles.icon} />
        </Button>
      </form>

      <div className={styles.footer}>
        <Button
          type="button"
          variant="link"
          className={styles['link-small']}
          onClick={() => navigate('/login')}
        >
          Already have an account? Sign in
        </Button>
      </div>
    </AuthPageLayout>
  );
}
