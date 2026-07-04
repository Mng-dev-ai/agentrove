import { useState, useMemo } from 'react';
import toast from 'react-hot-toast';
import { GitBranch, Box, HardDrive, Loader2, ChevronDown, ChevronRight, Check } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button';
import { FloatingTooltip } from '@/components/ui/FloatingTooltip';
import { Input } from '@/components/ui/primitives/Input';
import { useGitBranchesQuery, useCheckoutBranchMutation } from '@/hooks/queries/useSandboxQueries';
import type { Workspace } from '@/types/workspace.types';
import { formatRelativeTime } from '@/utils/date';
import { cn } from '@/utils/cn';

const EMPTY_BRANCHES: string[] = [];

function sourceIcon(sourceType: string | null | undefined) {
  const cls = 'mt-0.5 h-3.5 w-3.5 shrink-0 text-text-quaternary dark:text-text-dark-quaternary';
  switch (sourceType) {
    case 'git':
      return <GitBranch className={cls} />;
    case 'local':
      return <HardDrive className={cls} />;
    default:
      return <Box className={cls} />;
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
        className={cn(
          'flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors duration-200',
          isSelected
            ? 'bg-surface-active dark:bg-surface-dark-active'
            : 'hover:bg-surface-hover dark:hover:bg-surface-dark-hover',
        )}
      >
        {sourceIcon(ws.source_type)}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-xs text-text-primary dark:text-text-dark-primary">
              {ws.name}
            </span>
            <span className="shrink-0 rounded-full bg-surface-tertiary px-1.5 py-0.5 text-2xs text-text-tertiary dark:bg-surface-dark-tertiary dark:text-text-dark-tertiary">
              {ws.source_type ?? 'empty'}
            </span>
            <span className="shrink-0 rounded-full bg-surface-tertiary px-1.5 py-0.5 text-2xs text-text-tertiary dark:bg-surface-dark-tertiary dark:text-text-dark-tertiary">
              {ws.sandbox_provider === 'host' ? 'host' : 'docker'}
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-2xs text-text-quaternary dark:text-text-dark-quaternary">
            <span>{formatRelativeTime(ws.updated_at)}</span>
            {ws.chat_count > 0 && (
              <>
                <span>·</span>
                <span>
                  {ws.chat_count} {ws.chat_count === 1 ? 'chat' : 'chats'}
                </span>
              </>
            )}
          </div>
        </div>
      </Button>
      {showBranchSelector && (
        <div className="ml-6 mt-0.5">
          <Button
            variant="unstyled"
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (branchesExpanded) setBranchSearch('');
              setBranchesExpanded(!branchesExpanded);
            }}
            className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left transition-colors duration-200 hover:bg-surface-hover dark:hover:bg-surface-dark-hover"
          >
            {branchesExpanded ? (
              <ChevronDown className="h-3 w-3 shrink-0 text-text-quaternary dark:text-text-dark-quaternary" />
            ) : (
              <ChevronRight className="h-3 w-3 shrink-0 text-text-quaternary dark:text-text-dark-quaternary" />
            )}
            <GitBranch className="h-3 w-3 shrink-0 text-text-quaternary dark:text-text-dark-quaternary" />
            <span className="truncate font-mono text-2xs text-text-secondary dark:text-text-dark-secondary">
              {branchesData?.current_branch || '…'}
            </span>
          </Button>
          {branchesExpanded && (
            <div className="mt-0.5 overflow-hidden rounded-md border border-border/50 dark:border-border-dark/50">
              {branchesLoading ? (
                <div className="flex items-center justify-center gap-1.5 px-2 py-3">
                  <Loader2 className="h-3 w-3 animate-spin text-text-quaternary motion-reduce:animate-none dark:text-text-dark-quaternary" />
                  <span className="text-2xs text-text-quaternary dark:text-text-dark-quaternary">
                    Loading branches…
                  </span>
                </div>
              ) : !branches.length ? (
                <p className="px-2 py-3 text-center text-2xs text-text-quaternary dark:text-text-dark-quaternary">
                  No branches found
                </p>
              ) : (
                <>
                  {branches.length >= 6 && (
                    <div className="border-b border-border/50 px-2 py-1 dark:border-border-dark/50">
                      <Input
                        variant="unstyled"
                        type="text"
                        value={branchSearch}
                        onChange={(e) => setBranchSearch(e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        placeholder="Search branches…"
                        className="w-full bg-transparent text-2xs text-text-primary outline-none placeholder:text-text-quaternary dark:text-text-dark-primary dark:placeholder:text-text-dark-quaternary"
                      />
                    </div>
                  )}
                  <div className="max-h-[10rem] overflow-y-auto">
                    {sortedBranches.length === 0 ? (
                      <p className="px-2 py-2 text-center text-2xs text-text-quaternary dark:text-text-dark-quaternary">
                        No matching branches
                      </p>
                    ) : (
                      <div className="flex flex-col py-0.5">
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
                                className={cn(
                                  'flex w-full items-center gap-1.5 px-2 py-1 text-left text-2xs transition-colors duration-200 disabled:opacity-50',
                                  isCurrent
                                    ? 'bg-surface-active text-text-primary dark:bg-surface-dark-active dark:text-text-dark-primary'
                                    : 'text-text-secondary hover:bg-surface-hover dark:text-text-dark-secondary dark:hover:bg-surface-dark-hover',
                                )}
                              >
                                {isCurrent ? (
                                  <Check className="h-3 w-3 shrink-0" />
                                ) : (
                                  <span className="h-3 w-3 shrink-0" />
                                )}
                                <FloatingTooltip content={branch} className="min-w-0 flex-1">
                                  <span className="truncate font-mono">{branch}</span>
                                </FloatingTooltip>
                              </Button>
                              {showDivider && (
                                <div className="my-0.5 border-t border-border/50 dark:border-border-dark/50" />
                              )}
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
