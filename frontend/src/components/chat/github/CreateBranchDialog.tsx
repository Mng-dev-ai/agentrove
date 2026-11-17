import { useState } from 'react';
import toast from 'react-hot-toast';
import { BaseModal } from '@/components/ui/shared/BaseModal/BaseModal';
import { ModalHeader } from '@/components/ui/shared/ModalHeader/ModalHeader';
import { DialogFooter } from '@/components/ui/shared/DialogFooter/DialogFooter';
import { Input } from '@/components/ui/primitives/Input/Input';
import { Label } from '@/components/ui/primitives/Label/Label';
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
    <BaseModal isOpen={true} onClose={onClose} size="sm">
      <ModalHeader title="Create branch" onClose={onClose} />
      <div className={styles.body}>
        <div className={styles.fields}>
          <div>
            <Label htmlFor="create-branch-name" className={styles.label}>
              Branch name
            </Label>
            <Input
              id="create-branch-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="feature/my-branch"
              className={styles.input}
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
            <Label htmlFor="create-branch-base" className={styles.label}>
              From
            </Label>
            <Select
              id="create-branch-base"
              value={baseBranch}
              onChange={(e) => setBaseBranch(e.target.value)}
              className={styles.select}
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

      <DialogFooter
        onCancel={onClose}
        onSave={handleCreate}
        saveLabel="Create and checkout"
        saving={createBranch.isPending}
      />
    </BaseModal>
  );
}
