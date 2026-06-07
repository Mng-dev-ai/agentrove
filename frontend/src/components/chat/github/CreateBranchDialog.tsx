import { useState } from 'react';
import { GitBranch } from 'lucide-react';
import toast from 'react-hot-toast';
import { BaseModal } from '@/components/ui/shared/BaseModal';
import { Button } from '@/components/ui/primitives/Button';
import { Input } from '@/components/ui/primitives/Input';
import { Select } from '@/components/ui/primitives/Select';
import { useActiveChat } from '@/hooks/useActiveChat';
import { useGitBranchesQuery, useGitCreateBranchMutation } from '@/hooks/queries/useSandboxQueries';

interface CreateBranchDialogProps {
  onClose: () => void;
}

export function CreateBranchDialog({ onClose }: CreateBranchDialogProps) {
  const currentChat = useActiveChat();
  const sandboxId = currentChat?.sandbox_id ?? '';
  const worktreeCwd = currentChat?.worktree_cwd ?? undefined;
  const { data: branchesData } = useGitBranchesQuery(sandboxId, !!sandboxId, worktreeCwd);
  const createBranch = useGitCreateBranchMutation();

  const [name, setName] = useState('');
  const [baseBranch, setBaseBranch] = useState('');

  const handleCreate = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error('Please enter a branch name');
      return;
    }
    if (!sandboxId) {
      toast.error('No sandbox connected');
      return;
    }

    try {
      const result = await createBranch.mutateAsync({
        sandboxId,
        name: trimmed,
        baseBranch: baseBranch || undefined,
        cwd: worktreeCwd,
      });
      if (result.success) {
        toast.success(`Created and checked out ${result.current_branch}`);
        onClose();
      } else {
        toast.error(result.error || 'Failed to create branch');
      }
    } catch {
      toast.error('Failed to create branch');
    }
  };

  return (
    <BaseModal isOpen={true} onClose={onClose} size="sm" zIndex="modalHighest">
      <div className="p-5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-surface-tertiary dark:bg-surface-dark-tertiary">
            <GitBranch className="h-4 w-4 text-text-tertiary dark:text-text-dark-tertiary" />
          </div>
          <h2 className="text-sm font-medium text-text-primary dark:text-text-dark-primary">
            Create branch
          </h2>
        </div>

        <div className="mt-4 space-y-3">
          <div>
            <label className="mb-1.5 block text-2xs font-medium uppercase tracking-wider text-text-quaternary dark:text-text-dark-quaternary">
              Branch name
            </label>
            <Input
              variant="unstyled"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="feature/my-branch"
              className="w-full rounded-lg border border-border/50 bg-surface-secondary px-3 py-1.5 text-xs text-text-primary outline-none transition-colors duration-200 focus:border-border-hover dark:border-border-dark/50 dark:bg-surface-dark-secondary dark:text-text-dark-primary dark:focus:border-border-dark-hover"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleCreate();
                }
              }}
              autoFocus
            />
          </div>

          <div>
            <label className="mb-1.5 block text-2xs font-medium uppercase tracking-wider text-text-quaternary dark:text-text-dark-quaternary">
              From
            </label>
            <Select
              value={baseBranch}
              onChange={(e) => setBaseBranch(e.target.value)}
              className="h-8 bg-surface-secondary px-3 py-1.5 text-xs text-text-primary dark:bg-surface-dark-secondary dark:text-text-dark-primary"
            >
              <option value="">
                Current branch
                {branchesData?.current_branch ? ` (${branchesData.current_branch})` : ''}
              </option>
              {branchesData?.branches.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </Select>
          </div>
        </div>
      </div>

      <div className="flex justify-end gap-2 border-t border-border/50 px-5 py-3.5 dark:border-border-dark/50">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onClose}
          disabled={createBranch.isPending}
        >
          Cancel
        </Button>
        <Button
          type="button"
          variant="primary"
          size="sm"
          onClick={handleCreate}
          disabled={createBranch.isPending}
        >
          {createBranch.isPending ? 'Creating...' : 'Create and checkout'}
        </Button>
      </div>
    </BaseModal>
  );
}
