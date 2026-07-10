import { Eye, EyeOff } from 'lucide-react';
import clsx from 'clsx';
import { Button } from '@/components/ui/primitives/Button/Button';
import { Input } from '@/components/ui/primitives/Input/Input';
import { Link } from '@/components/ui/primitives/Link/Link';
import type { HelperTextLink, HelperTextCode } from '@/types/settings.types';
import styles from './SecretInput.module.scss';

export interface SecretInputProps {
  value: string;
  placeholder: string;
  isVisible: boolean;
  onChange: (newValue: string) => void;
  onBlur?: () => void;
  onToggleVisibility: () => void;
  helperText?: HelperTextLink | HelperTextCode;
  containerClassName?: string;
  inputClassName?: string;
  buttonClassName?: string;
}

const renderHelperText = (helperText?: HelperTextLink | HelperTextCode) => {
  if (!helperText) return null;

  if ('code' in helperText) {
    return (
      <p className={styles.helper}>
        {helperText.prefix} <code className={styles.code}>{helperText.code}</code>{' '}
        {helperText.suffix}
      </p>
    );
  } else {
    return (
      <p className={styles.helper}>
        {helperText.prefix}{' '}
        <Link
          href={helperText.href}
          variant="unstyled"
          target="_blank"
          rel="noopener noreferrer"
          className={styles.link}
        >
          {helperText.anchorText}
        </Link>
      </p>
    );
  }
};

export function SecretInput({
  value,
  placeholder,
  isVisible,
  onChange,
  onBlur,
  onToggleVisibility,
  helperText,
  containerClassName = styles['secret-input'],
  inputClassName,
  buttonClassName,
}: SecretInputProps) {
  return (
    <div className={containerClassName}>
      <div className={styles.field}>
        <Input
          type={isVisible ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          placeholder={placeholder}
          className={clsx(styles.input, inputClassName)}
        />
        <Button
          type="button"
          onClick={onToggleVisibility}
          variant="ghost"
          size="icon"
          className={clsx(styles['toggle-button'], buttonClassName)}
          aria-label={isVisible ? 'Hide value' : 'Show value'}
        >
          {isVisible ? (
            <EyeOff className={styles['toggle-icon']} />
          ) : (
            <Eye className={styles['toggle-icon']} />
          )}
        </Button>
      </div>
      {renderHelperText(helperText)}
    </div>
  );
}
