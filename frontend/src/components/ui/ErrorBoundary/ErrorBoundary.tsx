import { Component, ReactNode } from 'react';
import { Button } from '@/components/ui/primitives/Button/Button';
import { logger } from '@/utils/logger';
import styles from './ErrorBoundary.module.scss';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    logger.error('ErrorBoundary caught an error', 'ErrorBoundary', { error, errorInfo });
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className={styles['error-boundary']}>
          <p className={styles.title}>Something went wrong</p>
          <p className={styles.message}>
            {this.state.error?.message || 'An unexpected error occurred'}
          </p>
          <Button className={styles.reload} size="sm" onClick={reloadPage}>
            Reload page
          </Button>
        </div>
      );
    }

    return this.props.children;
  }
}

function reloadPage(): void {
  window.location.reload();
}
