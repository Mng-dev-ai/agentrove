import { useState, useEffect, useRef, useCallback } from 'react';
import { Sparkles } from 'lucide-react';
import { BaseModal } from './shared/BaseModal';
import { ModalHeader } from './shared/ModalHeader';
import { Button } from './primitives/Button/Button';
import { Input } from './primitives/Input/Input';
import { FloatingTooltip } from '@/components/ui/FloatingTooltip';
import { cancelButtonClass } from './shared/modalConstants';

interface RenameModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (newTitle: string) => Promise<void>;
  currentTitle: string;
  isLoading?: boolean;
  // Resolves to '' on failure (caller shows the toast) so the input is left untouched.
  onGenerateTitle?: () => Promise<string>;
  isGenerating?: boolean;
}

export function RenameModal({
  isOpen,
  onClose,
  onSave,
  currentTitle,
  isLoading = false,
  onGenerateTitle,
  isGenerating = false,
}: RenameModalProps) {
  const [title, setTitle] = useState(currentTitle);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setTitle(currentTitle);
    }
  }, [isOpen, currentTitle]);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isOpen]);

  const handleSave = useCallback(async () => {
    const trimmedTitle = title.trim();
    if (trimmedTitle === '') return;

    await onSave(trimmedTitle);
  }, [title, onSave]);

  const handleGenerate = useCallback(async () => {
    if (!onGenerateTitle) return;

    const generated = await onGenerateTitle();
    if (generated) {
      setTitle(generated);
      inputRef.current?.focus();
    }
  }, [onGenerateTitle]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;

      if (e.key === 'Enter' && !isLoading && title.trim() !== '') {
        e.preventDefault();
        handleSave();
      } else if (e.key === 'Escape' && !isLoading) {
        e.preventDefault();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isLoading, title, handleSave, onClose]);

  const isSaveDisabled = title.trim() === '' || isLoading;

  if (!isOpen) return null;

  return (
    <BaseModal isOpen={isOpen} onClose={onClose} size="md" zIndex="modalHighest">
      <ModalHeader title="Rename Chat" onClose={onClose} />

      <div className="flex items-center gap-2 p-4">
        <Input
          ref={inputRef}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Enter chat title"
          disabled={isLoading}
          className="w-full"
          aria-label="New name"
        />
        {onGenerateTitle && (
          <FloatingTooltip
            content={isGenerating ? 'Generating title…' : 'Generate title with AI'}
            className="flex"
          >
            <Button
              type="button"
              variant="unstyled"
              onClick={handleGenerate}
              disabled={isLoading || isGenerating}
              className="shrink-0 rounded-md p-2 text-text-tertiary transition-colors duration-200 hover:bg-surface-hover hover:text-text-secondary dark:text-text-dark-tertiary dark:hover:bg-surface-dark-hover dark:hover:text-text-dark-primary"
              aria-label={isGenerating ? 'Generating title…' : 'Generate title with AI'}
            >
              <Sparkles className={`h-3.5 w-3.5 ${isGenerating ? 'animate-spin' : ''}`} />
            </Button>
          </FloatingTooltip>
        )}
      </div>

      <div className="flex justify-end gap-2 border-t border-border p-4 dark:border-border-dark">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onClose}
          disabled={isLoading}
          className={cancelButtonClass}
        >
          Cancel
        </Button>
        <Button
          type="button"
          variant="primary"
          size="sm"
          onClick={handleSave}
          disabled={isSaveDisabled}
          isLoading={isLoading}
        >
          Save
        </Button>
      </div>
    </BaseModal>
  );
}
