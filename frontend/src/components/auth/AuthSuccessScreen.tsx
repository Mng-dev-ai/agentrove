import { type ReactNode } from 'react';
import { CheckCircle } from 'lucide-react';
import { Layout } from '@/components/layout/Layout';
import { Button } from '@/components/ui/primitives/Button/Button';

interface AuthSuccessScreenProps {
  title: string;
  description: string;
  infoMessage?: string;
  buttonLabel: string;
  buttonIcon?: ReactNode;
  onButtonClick: () => void;
  footer?: string;
}

export function AuthSuccessScreen({
  title,
  description,
  infoMessage,
  buttonLabel,
  buttonIcon,
  onButtonClick,
  footer,
}: AuthSuccessScreenProps) {
  return (
    <Layout isAuthPage={true}>
      <div className="flex h-full flex-col bg-surface-secondary dark:bg-surface-dark-secondary">
        <div className="flex flex-1 flex-col items-center justify-center p-4">
          <div className="relative z-10 w-full max-w-sm space-y-5">
            <div className="flex justify-center">
              <CheckCircle className="h-6 w-6 text-text-primary dark:text-text-dark-primary" />
            </div>

            <div className="rounded-xl border border-border/50 bg-surface-tertiary p-6 shadow-medium dark:border-border-dark/50 dark:bg-surface-dark-tertiary">
              <div className="mb-5 space-y-1.5 text-center">
                <h2 className="text-lg font-semibold text-text-primary dark:text-text-dark-primary">
                  {title}
                </h2>
                <p className="text-xs text-text-tertiary dark:text-text-dark-tertiary">
                  {description}
                </p>
              </div>

              {infoMessage && (
                <div className="mb-5 rounded-lg border border-border/50 bg-surface-hover/50 p-3 dark:border-border-dark/50 dark:bg-surface-dark-hover/50">
                  <p className="text-xs text-text-secondary dark:text-text-dark-secondary">
                    {infoMessage}
                  </p>
                </div>
              )}

              <Button onClick={onButtonClick} variant="primary" size="lg" className="w-full">
                {buttonIcon}
                {buttonLabel}
              </Button>
            </div>

            {footer && (
              <p className="text-center text-2xs text-text-quaternary dark:text-text-dark-quaternary">
                {footer}
              </p>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
}
