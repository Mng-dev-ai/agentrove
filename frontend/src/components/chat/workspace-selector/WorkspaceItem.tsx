import { useState, useMemo } from 'react';
import toast from 'react-hot-toast';
import { GitBranch, Box, HardDrive, Loader2, ChevronDown, ChevronRight, Check } from 'lucide-react';
import clsx from 'clsx';
import { Button } from '@/components/ui/primitives/Button/Button';
import { FloatingTooltip } from '@/components/ui/FloatingTooltip/FloatingTooltip';
import { Input } from '@/components/ui/primitives/Input/Input';
import { useGitBranchesQuery, useCheckoutBranchMutation } from '@/hooks/queries/useSandboxQueries';
import type { Workspace } from '@/types/workspace.types';
import { formatRelativeTime } from '@/utils/date';
import styles from './WorkspaceItem.module.scss';

const EMPTY_BRANCHES: string[] = [];

function sourceIcon(sourceType: string | null | undefined) {
  switch (sourceType) {
    case 'git':
      return <GitBranch className={styles['source-icon']} aria-hidden="true" />;
    case 'local':
      return <HardDrive className={styles['source-icon']} aria-hidden="true" />;
    default:
      return <Box className={styles['source-icon']} aria-hidden="true" />;
  }
}

function sourceLabel(sourceType: string | null | undefined) {
  switch (sourceType) {
    case 'git':
      return 'Git repository';
    case 'local':
      return 'Local folder';
    default:
      return 'Empty workspace';
  }
}

export function WorkspaceItem({
  ws,
  isSelected,
  isPickerOpen,
  showBranches,
  onSelect,
}: {
  ws: Workspace;
  isSelected: boolean;
  isPickerOpen: boolean;
  // Git branch switching hits the local sandbox API, so it only applies to local
  // workspaces — cloud workspaces live on the VPS and have no reachable sandbox here.
  showBranches: boolean;
  onSelect: (ws: Workspace) => void;
}) {
  const [branchesExpanded, setBranchesExpanded] = useState(false);
  const [branchSearch, setBranchSearch] = useState('');
  const hasSandbox = !!ws.sandbox_id;

  const { data: branchesData, isLoading: branchesLoading } = useGitBranchesQuery(
    ws.sandbox_id,
    isPickerOpen && hasSandbox && showBranches,
  );
  const checkoutBranch = useCheckoutBranchMutation();

  const showBranchSelector = showBranches && branchesData?.is_git_repo === true;
  const branches = branchesData?.branches ?? EMPTY_BRANCHES;

  // Pin current branch at top so it's always visible without scrolling
  const currentBranch = branchesData?.current_branch;
  const sortedBranches = useMemo(() => {
    const searchLower = branchSearch.toLowerCase();
    const filtered = branchSearch
      ? branches.filter((b) => b.toLowerCase().includes(searchLower))
      : branches;
    if (!currentBranch) return filtered;
    const others = filtered.filter((b) => b !== currentBranch);
    const currentVisible = !branchSearch || currentBranch.toLowerCase().includes(searchLower);
    return currentVisible ? [currentBranch, ...others] : others;
  }, [branches, currentBranch, branchSearch]);

  return (
    <div>
      <Button
        variant="unstyled"
        type="button"
        onClick={() => onSelect(ws)}
        aria-pressed={isSelected}
        className={clsx(styles.item, styles[isSelected ? 'item--selected' : 'item--unselected'])}
      >
        {sourceIcon(ws.source_type)}
        <div className={styles.content}>
          <div className={styles['name-row']}>
            <span className={styles.name}>{ws.name}</span>
            <span className={styles.badge}>
              {ws.sandbox_provider === 'host' ? 'Host' : 'Docker'}
            </span>
            {isSelected && <Check className={styles['selected-icon']} aria-hidden="true" />}
          </div>
          <div className={styles['meta-row']}>
            <span>{sourceLabel(ws.source_type)}</span>
            <span aria-hidden="true">·</span>
            <span>{formatRelativeTime(ws.updated_at)}</span>
            {ws.chat_count > 0 && (
              <>
                <span aria-hidden="true">·</span>
                <span>
                  {ws.chat_count} {ws.chat_count === 1 ? 'chat' : 'chats'}
                </span>
              </>
            )}
          </div>
        </div>
      </Button>
      {showBranchSelector && (
        <div className={styles.branches}>
          <Button
            variant="unstyled"
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (branchesExpanded) setBranchSearch('');
              setBranchesExpanded(!branchesExpanded);
            }}
            aria-expanded={branchesExpanded}
            className={styles['branch-toggle']}
          >
            {branchesExpanded ? (
              <ChevronDown className={styles['branch-toggle-icon']} aria-hidden="true" />
            ) : (
              <ChevronRight className={styles['branch-toggle-icon']} aria-hidden="true" />
            )}
            <GitBranch className={styles['branch-toggle-icon']} aria-hidden="true" />
            <span className={styles['branch-toggle-label']}>
              {branchesData?.current_branch || '…'}
            </span>
          </Button>
          {branchesExpanded && (
            <div className={styles['branch-panel']}>
              {branchesLoading ? (
                <div className={styles['branch-loading']}>
                  <Loader2 className={styles['branch-loading-icon']} aria-hidden="true" />
                  <span className={styles['branch-loading-label']}>Loading branches…</span>
                </div>
              ) : !branches.length ? (
                <p className={styles['branch-empty']}>No branches found</p>
              ) : (
                <>
                  {branches.length >= 6 && (
                    <div className={styles['branch-search']}>
                      <Input
                        variant="unstyled"
                        type="text"
                        name={`branch-search-${ws.id}`}
                        aria-label={`Search branches in ${ws.name}`}
                        autoComplete="off"
                        spellCheck={false}
                        value={branchSearch}
                        onChange={(e) => setBranchSearch(e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        placeholder="Search branches…"
                        className={styles['branch-search-input']}
                      />
                    </div>
                  )}
                  <div className={styles['branch-list']}>
                    {sortedBranches.length === 0 ? (
                      <p className={styles['branch-list-empty']}>No matching branches</p>
                    ) : (
                      <div className={styles['branch-rows']}>
                        {sortedBranches.map((branch, index) => {
                          const isCurrent = branch === branchesData.current_branch;
                          // Divider after pinned current branch to visually separate it
                          const showDivider = isCurrent && index === 0 && sortedBranches.length > 1;
                          return (
                            <div key={branch}>
                              <Button
                                variant="unstyled"
                                type="button"
                                disabled={checkoutBranch.isPending}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (isCurrent) return;
                                  checkoutBranch.mutate(
                                    { sandboxId: ws.sandbox_id, branch },
                                    {
                                      onSuccess: (data) => {
                                        if (data.success) {
                                          toast.success(`Switched to ${branch}`);
                                        } else {
                                          toast.error(data.error ?? 'Failed to switch branch');
                                        }
                                      },
                                      onError: (err) => {
                                        toast.error(
                                          err instanceof Error
                                            ? err.message
                                            : 'Failed to switch branch',
                                        );
                                      },
                                    },
                                  );
                                }}
                                className={clsx(
                                  styles['branch-row'],
                                  isCurrent && styles['branch-row--current'],
                                )}
                              >
                                {isCurrent ? (
                                  <Check
                                    className={styles['branch-row-check']}
                                    aria-hidden="true"
                                  />
                                ) : (
                                  <span className={styles['branch-row-check']} />
                                )}
                                <FloatingTooltip
                                  content={branch}
                                  className={styles['branch-row-tooltip']}
                                >
                                  <span className={styles['branch-row-name']}>{branch}</span>
                                </FloatingTooltip>
                              </Button>
                              {showDivider && <div className={styles['branch-divider']} />}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
