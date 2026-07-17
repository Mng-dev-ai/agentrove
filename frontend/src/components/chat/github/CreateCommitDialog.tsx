import { useState } from 'react';
import { GitCommitHorizontal, Sparkles } from 'lucide-react';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import { BaseModal } from '@/components/ui/shared/BaseModal/BaseModal';
import { Button } from '@/components/ui/primitives/Button/Button';
import { FloatingTooltip } from '@/components/ui/FloatingTooltip/FloatingTooltip';
import { Textarea } from '@/components/ui/primitives/Textarea/Textarea';
import { useActiveChat } from '@/hooks/useActiveChat';
import { useModelStore } from '@/store/modelStore';
import { useGitCommitMutation, useGitDiffQuery } from '@/hooks/queries/useSandboxQueries';
import { useGenerateCommitMessageMutation } from '@/hooks/queries/useGitHubQueries';
import { MAX_DIFF_LENGTH } from '@/config/constants';
import styles from './CreateCommitDialog.module.scss';

interface CreateCommitDialogProps {
  onClose: () => void;
}

export function CreateCommitDialog({ onClose }: CreateCommitDialogProps) {
  const currentChat = useActiveChat();
  const sandboxId = currentChat?.sandbox_id ?? '';
  const worktreeCwd = currentChat?.worktree_cwd ?? undefined;
  const commitMutation = useGitCommitMutation();
  // Generation runs on the backend that owns the chat (local or cloud VPS).
  const generateMessage = useGenerateCommitMessageMutation(currentChat?.id);

  const { data: diffData, isPlaceholderData } = useGitDiffQuery(
    sandboxId,
    'all',
    false,
    worktreeCwd,
  );
  // Resolve the model from the active git chat (modelStore is keyed per chat), not
  // the primary chat session — in split view this dialog targets the secondary pane.
  const selectedModelId = useModelStore((s) =>
    currentChat ? (s.modelByChat[currentChat.id] ?? '') : '',
  );

  const hasDiff = !!diffData?.diff && !isPlaceholderData;
  const hasModel = !!selectedModelId.trim();
  const canGenerate = hasDiff && hasModel && !generateMessage.isPending;
  const generateDisabledReason = !hasModel
    ? 'Select a model first'
    : !hasDiff
      ? (diffData?.error ?? 'No changes to commit')
      : undefined;

  const [message, setMessage] = useState('');

  const handleGenerate = async () => {
    if (!diffData?.diff) return;
    const rawDiff = diffData.diff;
    const diff =
      rawDiff.length > MAX_DIFF_LENGTH
        ? rawDiff.slice(0, MAX_DIFF_LENGTH) + '\n\n(diff truncated)'
        : rawDiff;
    try {
      const result = await generateMessage.mutateAsync({
        diff,
        model_id: selectedModelId,
      });
      setMessage(result.message);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to generate commit message');
    }
  };

  const handleCommit = async () => {
    const trimmed = message.trim();
    if (!trimmed) {
      toast.error('Please enter a commit message');
      return;
    }
    if (!sandboxId) {
      toast.error('No sandbox connected');
      return;
    }

    try {
      const result = await commitMutation.mutateAsync({
        sandboxId,
        message: trimmed,
        cwd: worktreeCwd,
      });
      if (result.success) {
        toast.success('Changes committed');
        onClose();
      } else {
        toast.error(result.error || 'Commit failed');
      }
    } catch {
      toast.error('Commit failed');
    }
  };

  return (
    <BaseModal isOpen={true} onClose={onClose} size="sm" zIndex="modalHighest">
      <div className={styles.body}>
        <div className={styles.header}>
          <div className={styles['icon-box']}>
            <GitCommitHorizontal className={styles['header-icon']} />
          </div>
          <h2 className={styles.title}>Create commit</h2>
        </div>

        <div className={styles.field}>
          <div className={styles['field-header']}>
            <label className={styles['field-label']}>Commit message</label>
            <FloatingTooltip
              content={generateDisabledReason ?? ''}
              className={styles['tooltip-wrap']}
            >
              <Button
                type="button"
                variant="unstyled"
                onClick={handleGenerate}
                disabled={!canGenerate}
                className={styles['generate-button']}
              >
                <Sparkles
                  className={clsx(
                    styles['generate-icon'],
                    generateMessage.isPending && styles['generate-icon--pulsing'],
                  )}
                />
                {generateMessage.isPending ? 'Generating...' : 'Generate with AI'}
              </Button>
            </FloatingTooltip>
          </div>
          <Textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Describe your changes..."
            rows={5}
            variant="unstyled"
            className={styles['message-textarea']}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                handleCommit();
              }
            }}
            autoFocus
          />
          <p className={styles.hint}>All changes will be staged and committed.</p>
        </div>
      </div>

      <div className={styles.footer}>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onClose}
          disabled={commitMutation.isPending}
        >
          Cancel
        </Button>
        <Button
          type="button"
          variant="primary"
          size="sm"
          onClick={handleCommit}
          disabled={commitMutation.isPending}
        >
          {commitMutation.isPending ? 'Committing...' : 'Commit'}
        </Button>
      </div>
    </BaseModal>
  );
}
