import { memo, useMemo } from 'react';
import toast from 'react-hot-toast';
import { GitBranch } from 'lucide-react';
import { Dropdown, DropdownItemType } from '@/components/ui/primitives/Dropdown/Dropdown';
import { useChatContext } from '@/hooks/useChatContext';
import { useIsSplitMode } from '@/hooks/useIsSplitMode';
import { useGitBranchesQuery, useCheckoutBranchMutation } from '@/hooks/queries/useSandboxQueries';
import styles from './BranchSelector.module.scss';

export interface BranchSelectorProps {
  dropdownPosition?: 'top' | 'bottom';
  disabled?: boolean;
  variant?: 'default' | 'text';
  dropdownAlign?: 'left' | 'right';
}

export const BranchSelector = memo(function BranchSelector({
  dropdownPosition = 'bottom',
  dropdownAlign,
  disabled = false,
  variant = 'default',
}: BranchSelectorProps) {
  const { sandboxId, worktreeCwd } = useChatContext();
  const isSplitMode = useIsSplitMode();

  const { data: branchesData } = useGitBranchesQuery(sandboxId, !!sandboxId, worktreeCwd);
  const checkoutBranch = useCheckoutBranchMutation();

  const groupedItems = useMemo<DropdownItemType<string>[]>(() => {
    if (!branchesData) return [];
    const current = branchesData.current_branch;
    const others = branchesData.branches.filter((b) => b !== current);
    const items: DropdownItemType<string>[] = [{ type: 'item', data: current }];
    if (others.length > 0) {
      items.push({ type: 'header', label: 'Branches' });
      others.forEach((b) => items.push({ type: 'item', data: b }));
    }
    return items;
  }, [branchesData]);

  if (!sandboxId || !branchesData?.is_git_repo || branchesData.branches.length === 0) {
    return null;
  }

  const currentBranch = branchesData.current_branch;

  return (
    <Dropdown
      value={currentBranch}
      items={groupedItems}
      getItemKey={(branch) => branch}
      getItemLabel={(branch) => branch}
      onSelect={(branch) => {
        if (branch === currentBranch) return;
        checkoutBranch.mutate(
          { sandboxId, branch, cwd: worktreeCwd },
          {
            onSuccess: (data) => {
              if (data.success) {
                toast.success(`Switched to ${branch}`);
              } else {
                toast.error(data.error ?? 'Failed to switch branch');
              }
            },
            onError: (err) => {
              toast.error(err instanceof Error ? err.message : 'Failed to switch branch');
            },
          },
        );
      }}
      leftIcon={GitBranch}
      getItemShortLabel={(branch) => (branch.length > 16 ? branch.slice(0, 16) + '…' : branch)}
      width="16rem"
      dropdownPosition={dropdownPosition}
      disabled={disabled || checkoutBranch.isPending}
      compactOnMobile
      forceCompact={isSplitMode}
      triggerVariant={variant}
      dropdownAlign={dropdownAlign}
      searchable={branchesData.branches.length >= 6}
      searchPlaceholder="Search branches..."
      searchVariant="underline"
      itemClassName={styles['item-mono']}
    />
  );
});
