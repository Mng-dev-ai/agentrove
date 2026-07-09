import { Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button/Button';
import { Input } from '@/components/ui/primitives/Input/Input';
import { Link } from '@/components/ui/primitives/Link/Link';
import { cn } from '@/utils/cn';
import type { HelperTextLink, HelperTextCode } from '@/types/settings.types';

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
      <p className="mt-1.5 break-words text-2xs text-text-quaternary dark:text-text-dark-quaternary">
        {helperText.prefix}{' '}
        <code className="break-all rounded bg-surface-tertiary px-1 py-0.5 text-text-primary dark:bg-surface-dark-tertiary dark:text-text-dark-primary">
          {helperText.code}
        </code>{' '}
        {helperText.suffix}
      </p>
    );
  } else {
    return (
      <p className="mt-1.5 break-words text-2xs text-text-quaternary dark:text-text-dark-quaternary">
        {helperText.prefix}{' '}
        <Link
          href={helperText.href}
          variant="unstyled"
          target="_blank"
          rel="noopener noreferrer"
          className="break-all text-text-primary underline hover:text-text-secondary dark:text-text-dark-primary dark:hover:text-text-dark-secondary"
        >
          {helperText.anchorText}
        </Link>
      </p>
    );
  }
};

export const SecretInput: React.FC<SecretInputProps> = ({
  value,
  placeholder,
  isVisible,
  onChange,
  onBlur,
  onToggleVisibility,
  helperText,
  containerClassName = 'mt-2',
  inputClassName,
  buttonClassName,
}) => (
  <div className={containerClassName}>
    <div className="relative">
      <Input
        type={isVisible ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        placeholder={placeholder}
        className={cn('pr-9 text-xs', inputClassName)}
      />
      <Button
        type="button"
        onClick={onToggleVisibility}
        variant="ghost"
        size="icon"
        className={cn(
          'absolute right-1.5 top-1/2 h-7 w-7 -translate-y-1/2 rounded-md text-text-quaternary hover:text-text-secondary dark:text-text-dark-quaternary dark:hover:text-text-dark-secondary',
          buttonClassName,
        )}
        aria-label={isVisible ? 'Hide value' : 'Show value'}
      >
        {isVisible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
      </Button>
    </div>
    {renderHelperText(helperText)}
  </div>
);
