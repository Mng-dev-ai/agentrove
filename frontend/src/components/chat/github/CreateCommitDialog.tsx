import { useState } from 'react';
import { GitCommitHorizontal, Sparkles } from 'lucide-react';
import toast from 'react-hot-toast';
import { BaseModal } from '@/components/ui/shared/BaseModal/BaseModal';
import { Button } from '@/components/ui/primitives/Button/Button';
import { FloatingTooltip } from '@/components/ui/FloatingTooltip/FloatingTooltip';
import { Textarea } from '@/components/ui/primitives/Textarea/Textarea';
import { useActiveChat } from '@/hooks/useActiveChat';
import { useModelStore } from '@/store/modelStore';
import { useGitCommitMutation, useGitDiffQuery } from '@/hooks/queries/useSandboxQueries';
import { useGenerateCommitMessageMutation } from '@/hooks/queries/useGitHubQueries';
import { MAX_DIFF_LENGTH } from '@/config/constants';

interface CreateCommitDialogProps {
  onClose: () => void;
}

export function CreateCommitDialog({ onClose }: CreateCommitDialogProps) {
  const currentChat = useActiveChat();
  const sandboxId = currentChat?.sandbox_id ?? '';
  const worktreeCwd = currentChat?.worktree_cwd ?? undefined;
  const commitMutation = useGitCommitMutation();
  const generateMessage = useGenerateCommitMessageMutation();

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
      <div className="p-5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-surface-tertiary dark:bg-surface-dark-tertiary">
            <GitCommitHorizontal className="h-4 w-4 text-text-tertiary dark:text-text-dark-tertiary" />
          </div>
          <h2 className="text-sm font-medium text-text-primary dark:text-text-dark-primary">
            Create commit
          </h2>
        </div>

        <div className="mt-4">
          <div className="mb-1.5 flex items-center justify-between">
            <label className="text-2xs font-medium uppercase tracking-wider text-text-quaternary dark:text-text-dark-quaternary">
              Commit message
            </label>
            <FloatingTooltip content={generateDisabledReason ?? ''} className="flex">
              <Button
                type="button"
                variant="unstyled"
                onClick={handleGenerate}
                disabled={!canGenerate}
                className={`flex items-center gap-1 rounded-md px-1.5 py-0.5 text-2xs text-text-tertiary transition-colors duration-200 dark:text-text-dark-tertiary ${
                  canGenerate
                    ? 'hover:bg-surface-hover hover:text-text-secondary dark:hover:bg-surface-dark-hover dark:hover:text-text-dark-primary'
                    : 'cursor-not-allowed opacity-50'
                }`}
              >
                <Sparkles
                  className={`h-3 w-3 ${generateMessage.isPending ? 'animate-pulse' : ''}`}
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
            className="w-full resize-none rounded-lg border border-border/50 bg-surface-secondary px-3 py-1.5 text-xs text-text-primary outline-none transition-colors duration-200 focus:border-border-hover dark:border-border-dark/50 dark:bg-surface-dark-secondary dark:text-text-dark-primary dark:focus:border-border-dark-hover"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                handleCommit();
              }
            }}
            autoFocus
          />
          <p className="mt-1 text-2xs text-text-quaternary dark:text-text-dark-quaternary">
            All changes will be staged and committed.
          </p>
        </div>
      </div>

      <div className="flex justify-end gap-2 border-t border-border/50 px-5 py-3.5 dark:border-border-dark/50">
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
