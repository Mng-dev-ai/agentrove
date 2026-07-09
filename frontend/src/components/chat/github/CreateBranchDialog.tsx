import { useState } from 'react';
import { GitBranch } from 'lucide-react';
import toast from 'react-hot-toast';
import { BaseModal } from '@/components/ui/shared/BaseModal/BaseModal';
import { Button } from '@/components/ui/primitives/Button/Button';
import { Input } from '@/components/ui/primitives/Input/Input';
import { Select } from '@/components/ui/primitives/Select/Select';
import { useActiveChat } from '@/hooks/useActiveChat';
import { useGitBranchesQuery, useGitCreateBranchMutation } from '@/hooks/queries/useSandboxQueries';
import styles from './CreateBranchDialog.module.scss';

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
      <div className={styles.body}>
        <div className={styles.header}>
          <div className={styles['icon-box']}>
            <GitBranch className={styles['header-icon']} />
          </div>
          <h2 className={styles.title}>Create branch</h2>
        </div>

        <div className={styles.fields}>
          <div>
            <label className={styles.label}>Branch name</label>
            <Input
              variant="unstyled"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="feature/my-branch"
              className={styles['name-input']}
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
            <label className={styles.label}>From</label>
            <Select
              value={baseBranch}
              onChange={(e) => setBaseBranch(e.target.value)}
              className={styles['base-select']}
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

      <div className={styles.footer}>
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
