import { memo, useEffect, useMemo } from 'react';
import { GitBranch, GitFork } from 'lucide-react';
import { Dropdown } from '@/components/ui/primitives/Dropdown/Dropdown';
import { Switch } from '@/components/ui/primitives/Switch/Switch';
import {
  ToggleDropdown,
  type ToggleDropdownOption,
} from '@/components/ui/shared/ToggleDropdown/ToggleDropdown';
import { useChatContext } from '@/hooks/useChatContext';
import { useGitBranchesQuery } from '@/hooks/queries/useSandboxQueries';
import { useBranchCheckout } from '@/hooks/useBranchCheckout';
import { buildBranchItems, shortenBranchName } from '@/components/chat/branch-selector/branchItems';
import {
  useChatSettingsStore,
  DEFAULT_CHAT_SETTINGS_KEY,
  DEFAULT_WORKTREE,
} from '@/store/chatSettingsStore';
import type { GitBranchesData } from '@/types/sandbox.types';
import styles from './BranchWorktreeSelector.module.scss';

const TOGGLE_OPTIONS: readonly [ToggleDropdownOption, ToggleDropdownOption] = [
  { label: 'No worktree' },
  { label: 'Worktree' },
];

// Other chats' worktree branches — noise as base candidates, but still checkoutable.
const isWorktreeBranch = (branch: string) => /^worktree-/.test(branch);

const setWorktree = (enabled: boolean) =>
  useChatSettingsStore.getState().setWorktree(DEFAULT_CHAT_SETTINGS_KEY, enabled);

const setBase = (branch: string | undefined) =>
  useChatSettingsStore.getState().setWorktreeBaseBranch(DEFAULT_CHAT_SETTINGS_KEY, branch);

export interface BranchWorktreeDropdownProps {
  branchesData: GitBranchesData | undefined;
  worktree: boolean;
  onWorktreeChange: (enabled: boolean) => void;
  // The branch to check out (worktree off) or cut the new worktree from (worktree on).
  branch: string;
  onBranchChange: (branch: string) => void;
  disabled?: boolean;
}

export const BranchWorktreeDropdown = memo(function BranchWorktreeDropdown({
  branchesData,
  worktree,
  onWorktreeChange,
  branch,
  onBranchChange,
  disabled = false,
}: BranchWorktreeDropdownProps) {
  const branches = branchesData?.branches;
  const currentBranch = branchesData?.current_branch ?? '';

  const visibleBranches = useMemo(
    () => (worktree ? (branches ?? []).filter((b) => !isWorktreeBranch(b)) : (branches ?? [])),
    [branches, worktree],
  );

  const items = useMemo(
    () => buildBranchItems(visibleBranches, currentBranch),
    [visibleBranches, currentBranch],
  );

  const isDegraded = !branchesData?.is_git_repo || (branches?.length ?? 0) === 0;

  if (isDegraded) {
    return (
      <ToggleDropdown
        options={TOGGLE_OPTIONS}
        value={worktree}
        onSelect={onWorktreeChange}
        icon={GitFork}
        width="9rem"
        disabled={disabled}
      />
    );
  }

  const renderHeader = () => (
    <div className={styles.header}>
      <div
        role="switch"
        aria-checked={worktree}
        tabIndex={0}
        className={styles['worktree-row']}
        onClick={() => onWorktreeChange(!worktree)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onWorktreeChange(!worktree);
          }
        }}
      >
        <GitFork className={styles['worktree-icon']} />
        <span className={styles['worktree-label']}>Isolated worktree</span>
        <Switch
          checked={worktree}
          size="sm"
          tabIndex={-1}
          onClick={(e) => e.stopPropagation()}
          onCheckedChange={onWorktreeChange}
        />
      </div>
      <div role="separator" className={styles.divider} />
      <div className={styles['section-label']}>{worktree ? 'Base branch' : 'Branch'}</div>
    </div>
  );

  return (
    <Dropdown
      value={branch}
      items={items}
      getItemKey={(item) => item}
      getItemLabel={(item) => item}
      getItemShortLabel={(item) =>
        worktree ? `${shortenBranchName(item)} → worktree` : shortenBranchName(item)
      }
      onSelect={onBranchChange}
      leftIcon={GitBranch}
      triggerVariant="toolbar"
      width="17rem"
      disabled={disabled}
      searchable={visibleBranches.length >= 6}
      searchPlaceholder="Search branches..."
      searchVariant="underline"
      itemClassName={styles['item-mono']}
      renderHeader={renderHeader}
      renderFooter={
        worktree
          ? () => (
              <div className={styles.footer}>
                Creates a new worktree from {branch}. Shared workspace untouched.
              </div>
            )
          : undefined
      }
    />
  );
});

interface BranchWorktreeSelectorProps {
  disabled?: boolean;
}

// Landing composer control: worktree on/off plus, when the workspace is a git repo,
// the branch to check out (worktree off) or cut the new worktree from (worktree on).
export const BranchWorktreeSelector = memo(function BranchWorktreeSelector({
  disabled = false,
}: BranchWorktreeSelectorProps) {
  const { sandboxId, worktreeCwd } = useChatContext();
  const { data: branchesData } = useGitBranchesQuery(sandboxId, !!sandboxId, worktreeCwd);
  const { checkout, isPending } = useBranchCheckout(sandboxId, worktreeCwd);

  const worktree = useChatSettingsStore(
    (state) => state.worktreeByChat[DEFAULT_CHAT_SETTINGS_KEY] ?? DEFAULT_WORKTREE,
  );
  const storedBase = useChatSettingsStore(
    (state) => state.worktreeBaseBranchByChat[DEFAULT_CHAT_SETTINGS_KEY],
  );

  const branches = branchesData?.branches;
  const currentBranch = branchesData?.current_branch ?? '';

  // Drop a stored base the freshly loaded list no longer offers (workspace switched,
  // branch deleted) or when the repo has no branches — undefined = follow current.
  useEffect(() => {
    if (!branches || storedBase === undefined) return;
    if (branches.length === 0 || !branches.includes(storedBase)) {
      setBase(undefined);
    }
  }, [branches, storedBase]);

  const base = storedBase && branches?.includes(storedBase) ? storedBase : currentBranch;

  const handleSelect = (branch: string) => {
    if (worktree) {
      setBase(branch === currentBranch ? undefined : branch);
      return;
    }
    checkout(branch, currentBranch);
  };

  return (
    <BranchWorktreeDropdown
      branchesData={sandboxId ? branchesData : undefined}
      worktree={worktree}
      onWorktreeChange={setWorktree}
      branch={worktree ? base : currentBranch}
      onBranchChange={handleSelect}
      disabled={disabled || isPending}
    />
  );
});
