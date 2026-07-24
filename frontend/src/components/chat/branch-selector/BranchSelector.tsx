import { memo, useMemo } from 'react';
import { GitBranch } from 'lucide-react';
import { Dropdown, DropdownItemType } from '@/components/ui/primitives/Dropdown/Dropdown';
import { useChatContext } from '@/hooks/useChatContext';
import { useIsSplitMode } from '@/hooks/useIsSplitMode';
import { useGitBranchesQuery } from '@/hooks/queries/useSandboxQueries';
import { useBranchCheckout } from '@/hooks/useBranchCheckout';
import { buildBranchItems, shortenBranchName } from './branchItems';
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
  const { checkout, isPending } = useBranchCheckout(sandboxId, worktreeCwd);

  const groupedItems = useMemo<DropdownItemType<string>[]>(
    () =>
      branchesData ? buildBranchItems(branchesData.branches, branchesData.current_branch) : [],
    [branchesData],
  );

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
      onSelect={(branch) => checkout(branch, currentBranch)}
      leftIcon={GitBranch}
      getItemShortLabel={shortenBranchName}
      width="16rem"
      dropdownPosition={dropdownPosition}
      disabled={disabled || isPending}
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
