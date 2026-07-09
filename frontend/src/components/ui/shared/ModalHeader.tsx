import { ReactNode } from 'react';
import { X } from 'lucide-react';
import { Button } from '../primitives/Button/Button';
import { closeButtonClass } from './modalConstants';

export interface ModalHeaderProps {
  title: string;
  onClose: () => void;
  actions?: ReactNode;
}

export function ModalHeader({ title, onClose, actions }: ModalHeaderProps) {
  return (
    <div className="flex items-center justify-between border-b border-border p-4 dark:border-border-dark">
      <h3 className="text-lg font-semibold text-text-primary dark:text-text-dark-primary">
        {title}
      </h3>
      <div className="flex items-center gap-2">
        {actions}
        <Button
          onClick={onClose}
          variant="unstyled"
          className={closeButtonClass}
          aria-label="Close modal"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
