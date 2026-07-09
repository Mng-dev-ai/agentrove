import { Spinner } from '@/components/ui/primitives/Spinner/Spinner';

export const viewLoadingFallback = (
  <div className="flex h-full w-full items-center justify-center bg-surface-secondary dark:bg-surface-dark-secondary">
    <Spinner size="md" className="text-text-quaternary dark:text-text-dark-quaternary" />
  </div>
);
