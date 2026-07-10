import { useState, useEffect, useRef, useCallback } from 'react';
import { Sparkles } from 'lucide-react';
import clsx from 'clsx';
import { BaseModal } from '@/components/ui/shared/BaseModal/BaseModal';
import { ModalHeader } from '@/components/ui/shared/ModalHeader/ModalHeader';
import { Button } from '@/components/ui/primitives/Button/Button';
import { Input } from '@/components/ui/primitives/Input/Input';
import { FloatingTooltip } from '@/components/ui/FloatingTooltip/FloatingTooltip';
import styles from './RenameModal.module.scss';

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

      <div className={styles.body}>
        <Input
          ref={inputRef}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Enter chat title"
          disabled={isLoading}
          className={styles.input}
          aria-label="New name"
        />
        {onGenerateTitle && (
          <FloatingTooltip
            content={isGenerating ? 'Generating title…' : 'Generate title with AI'}
            className={styles['tooltip-wrap']}
          >
            <Button
              type="button"
              variant="unstyled"
              onClick={handleGenerate}
              disabled={isLoading || isGenerating}
              className={styles['generate-button']}
              aria-label={isGenerating ? 'Generating title…' : 'Generate title with AI'}
            >
              <Sparkles
                className={clsx(
                  styles['generate-icon'],
                  isGenerating && styles['generate-icon--spinning'],
                )}
              />
            </Button>
          </FloatingTooltip>
        )}
      </div>

      <div className={styles.footer}>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onClose}
          disabled={isLoading}
          className={styles['cancel-button']}
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
