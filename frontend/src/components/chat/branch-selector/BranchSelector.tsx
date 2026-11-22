import { memo, useMemo } from 'react';
import { GitBranch } from 'lucide-react';
import {
  Dropdown,
  DropdownItemType,
  type DropdownPosition,
} from '@/components/ui/primitives/Dropdown/Dropdown';
import { useChatContext } from '@/hooks/useChatContext';
import { useGitBranchesQuery } from '@/hooks/queries/useSandboxQueries';
import { useBranchCheckout } from '@/hooks/useBranchCheckout';
import { buildBranchItems } from './branchItems';
import styles from './BranchSelector.module.scss';

export interface BranchSelectorProps {
  dropdownPosition?: DropdownPosition;
  disabled?: boolean;
  compact?: boolean;
  variant?: 'default' | 'text';
  dropdownAlign?: 'left' | 'right';
}

export const BranchSelector = memo(function BranchSelector({
  dropdownPosition = 'bottom',
  dropdownAlign,
  disabled = false,
  compact = true,
  variant = 'default',
}: BranchSelectorProps) {
  const { sandboxId, worktreeCwd } = useChatContext();

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
      ariaLabel="Branch"
      width="16rem"
      dropdownPosition={dropdownPosition}
      disabled={disabled || isPending}
      compact={compact}
      triggerVariant={variant}
      iconWithLabel
      dropdownAlign={dropdownAlign}
      searchable={branchesData.branches.length >= 6}
      searchPlaceholder="Search branches..."
      searchVariant="underline"
      itemClassName={styles['item-mono']}
    />
  );
});
