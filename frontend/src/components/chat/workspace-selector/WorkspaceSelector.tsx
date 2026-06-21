import { useState, useCallback, useEffect, useMemo, memo } from 'react';
import toast from 'react-hot-toast';
import {
  FolderOpen,
  Search,
  GitBranch,
  Plus,
  Box,
  HardDrive,
  Lock,
  Loader2,
  ChevronDown,
  ChevronRight,
  Check,
} from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button';
import { Input } from '@/components/ui/primitives/Input';
import { BaseModal } from '@/components/ui/shared/BaseModal';
import { ModalHeader } from '@/components/ui/shared/ModalHeader';
import { useWorkspacesList, useCreateWorkspaceMutation } from '@/hooks/queries/useWorkspaceQueries';
import { useSettingsQuery } from '@/hooks/queries/useSettingsQueries';
import { useGitHubReposQuery } from '@/hooks/queries/useGitHubQueries';
import { useGitBranchesQuery, useCheckoutBranchMutation } from '@/hooks/queries/useSandboxQueries';
import type { Workspace } from '@/types/workspace.types';
import type { GitHubRepo } from '@/types/github.types';
import { formatRelativeTime } from '@/utils/date';
import { cn } from '@/utils/cn';
import { isDesktopApp } from '@/utils/platform';
import { open } from '@tauri-apps/plugin-dialog';

const VISIBLE_LIMIT = 5;
const EMPTY_BRANCHES: string[] = [];

type CreationMode = 'none' | 'menu' | 'empty' | 'git';

function ProviderToggle({
  value,
  onChange,
}: {
  value: 'docker' | 'host';
  onChange: (v: 'docker' | 'host') => void;
}) {
  const btnCls = (active: boolean) =>
    cn(
      'rounded-md px-2 py-0.5 text-2xs transition-colors duration-200',
      active
        ? 'bg-surface-active text-text-primary dark:bg-surface-dark-active dark:text-text-dark-primary'
        : 'text-text-quaternary hover:text-text-secondary dark:text-text-dark-quaternary dark:hover:text-text-dark-secondary',
    );
  return (
    <div className="flex items-center gap-1">
      <span className="text-2xs text-text-quaternary dark:text-text-dark-quaternary">
        Provider:
      </span>
      <Button
        variant="unstyled"
        type="button"
        onClick={() => onChange('host')}
        className={btnCls(value === 'host')}
      >
        Host
      </Button>
      <Button
        variant="unstyled"
        type="button"
        onClick={() => onChange('docker')}
        className={btnCls(value === 'docker')}
      >
        Docker
      </Button>
    </div>
  );
}

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

function WorkspaceItem({
  ws,
  isSelected,
  chatCount,
  isModalOpen,
  onSelect,
}: {
  ws: Workspace;
  isSelected: boolean;
  chatCount: number;
  isModalOpen: boolean;
  onSelect: (ws: Workspace) => void;
}) {
  const [branchesExpanded, setBranchesExpanded] = useState(false);
  const [branchSearch, setBranchSearch] = useState('');
  const hasSandbox = !!ws.sandbox_id;

  const { data: branchesData, isLoading: branchesLoading } = useGitBranchesQuery(
    ws.sandbox_id,
    isModalOpen && hasSandbox,
  );
  const checkoutBranch = useCheckoutBranchMutation();

  const showBranchSelector = branchesData?.is_git_repo === true;
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
        onClick={() => {
          setBranchesExpanded(false);
          setBranchSearch('');
          onSelect(ws);
        }}
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
            {chatCount > 0 && (
              <>
                <span>·</span>
                <span>
                  {chatCount} {chatCount === 1 ? 'chat' : 'chats'}
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
                                <span className="truncate font-mono" title={branch}>
                                  {branch}
                                </span>
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

const GitHubRepoItem = memo(function GitHubRepoItem({
  repo,
  onSelect,
  isCloning,
}: {
  repo: GitHubRepo;
  onSelect: (cloneUrl: string, name: string) => void | Promise<void>;
  isCloning: boolean;
}) {
  return (
    <Button
      variant="unstyled"
      type="button"
      disabled={isCloning}
      onClick={() => onSelect(repo.clone_url, repo.name)}
      className="flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors duration-200 hover:bg-surface-hover disabled:opacity-50 dark:hover:bg-surface-dark-hover"
    >
      <GitBranch className="mt-0.5 h-3.5 w-3.5 shrink-0 text-text-quaternary dark:text-text-dark-quaternary" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-xs text-text-primary dark:text-text-dark-primary">
            {repo.full_name}
          </span>
          {repo.private && (
            <span className="flex shrink-0 items-center gap-0.5 rounded-full bg-surface-tertiary px-1.5 py-0.5 text-2xs text-text-tertiary dark:bg-surface-dark-tertiary dark:text-text-dark-tertiary">
              <Lock className="h-2.5 w-2.5" />
              private
            </span>
          )}
        </div>
        {repo.description && (
          <p className="truncate text-2xs text-text-quaternary dark:text-text-dark-quaternary">
            {repo.description}
          </p>
        )}
        <div className="flex items-center gap-1.5 text-2xs text-text-quaternary dark:text-text-dark-quaternary">
          {repo.language && <span>{repo.language}</span>}
          {repo.pushed_at && (
            <>
              {repo.language && <span>·</span>}
              <span>{formatRelativeTime(repo.pushed_at)}</span>
            </>
          )}
        </div>
      </div>
    </Button>
  );
});

const SKELETON_ITEMS = [0, 1, 2];

function RepoListSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      {SKELETON_ITEMS.map((i) => (
        <div key={i} className="flex items-start gap-2.5 px-2.5 py-2">
          <div className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-pulse rounded bg-surface-tertiary motion-reduce:animate-none dark:bg-surface-dark-tertiary" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3 w-2/3 animate-pulse rounded bg-surface-tertiary motion-reduce:animate-none dark:bg-surface-dark-tertiary" />
            <div className="h-2.5 w-full animate-pulse rounded bg-surface-tertiary motion-reduce:animate-none dark:bg-surface-dark-tertiary" />
          </div>
        </div>
      ))}
    </div>
  );
}

interface WorkspaceSelectorProps {
  selectedWorkspaceId: string | null;
  onWorkspaceChange: (workspaceId: string | null) => void;
  enabled: boolean;
}

export function WorkspaceSelector({
  selectedWorkspaceId,
  onWorkspaceChange,
  enabled,
}: WorkspaceSelectorProps) {
  // isTauri() is true on iOS too — gate the host-filesystem "Local folder" option
  // on desktop only, where a real local sidecar and directory picker exist.
  const isDesktop = isDesktopApp();
  const workspaces = useWorkspacesList({ enabled });
  const { data: settings } = useSettingsQuery({ enabled });
  const createWorkspace = useCreateWorkspaceMutation();

  const hasGitHubToken = Boolean(settings?.github_personal_access_token);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [creationMode, setCreationMode] = useState<CreationMode>('none');
  const [emptyName, setEmptyName] = useState('');
  const [gitUrl, setGitUrl] = useState('');
  const [sandboxProvider, setSandboxProvider] = useState<'docker' | 'host'>('docker');
  const [repoSearchQuery, setRepoSearchQuery] = useState('');
  const [debouncedRepoQuery, setDebouncedRepoQuery] = useState('');
  const [showUrlInput, setShowUrlInput] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedRepoQuery(repoSearchQuery), 300);
    return () => clearTimeout(timer);
  }, [repoSearchQuery]);

  const { data: reposData, isLoading: reposLoading } = useGitHubReposQuery(
    debouncedRepoQuery,
    creationMode === 'git' && hasGitHubToken && !showUrlInput,
  );

  const selectedWorkspace = workspaces.find((ws) => ws.id === selectedWorkspaceId);
  const showSearch = workspaces.length > VISIBLE_LIMIT;

  const visibleWorkspaces = useMemo(() => {
    if (!searchQuery) return workspaces;
    const query = searchQuery.toLowerCase();
    return workspaces.filter((ws) => ws.name.toLowerCase().includes(query));
  }, [workspaces, searchQuery]);

  const closeModal = useCallback(() => {
    setIsModalOpen(false);
    setSearchQuery('');
    setCreationMode('none');
    setEmptyName('');
    setGitUrl('');
    setSandboxProvider('docker');
    setRepoSearchQuery('');
    setDebouncedRepoQuery('');
    setShowUrlInput(false);
  }, []);

  const selectWorkspace = useCallback(
    (workspace: Workspace) => {
      onWorkspaceChange(workspace.id);
      closeModal();
    },
    [onWorkspaceChange, closeModal],
  );

  const handleCreateEmpty = useCallback(async () => {
    const name = emptyName.trim() || 'Untitled';
    try {
      const workspace = await createWorkspace.mutateAsync({
        name,
        source_type: 'empty',
        sandbox_provider: sandboxProvider,
      });
      onWorkspaceChange(workspace.id);
      closeModal();
      toast.success('Workspace created');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to create workspace');
    }
  }, [createWorkspace, emptyName, sandboxProvider, onWorkspaceChange, closeModal]);

  const handleChooseLocal = useCallback(async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: 'Select Workspace Folder',
    });
    if (!selected || Array.isArray(selected)) return;
    try {
      const name = selected.split(/[\\/]/).filter(Boolean).pop() || 'Local';
      const workspace = await createWorkspace.mutateAsync({
        name,
        source_type: 'local',
        workspace_path: selected,
        sandbox_provider: sandboxProvider,
      });
      onWorkspaceChange(workspace.id);
      closeModal();
      toast.success('Workspace created');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to create workspace');
    }
  }, [createWorkspace, sandboxProvider, onWorkspaceChange, closeModal]);

  const cloneRepo = useCallback(
    async (url: string, name: string) => {
      try {
        const workspace = await createWorkspace.mutateAsync({
          name,
          source_type: 'git',
          git_url: url,
          sandbox_provider: sandboxProvider,
        });
        onWorkspaceChange(workspace.id);
        closeModal();
        toast.success('Repository cloned');
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to clone repository');
      }
    },
    [createWorkspace, sandboxProvider, onWorkspaceChange, closeModal],
  );

  const handleCloneGit = useCallback(async () => {
    const normalizedGitUrl = gitUrl.trim();
    if (!normalizedGitUrl) {
      toast.error('Enter a Git repository URL');
      return;
    }
    const name = normalizedGitUrl.split('/').pop()?.replace('.git', '') || 'Git Project';
    await cloneRepo(normalizedGitUrl, name);
  }, [gitUrl, cloneRepo]);

  const label = selectedWorkspace?.name || 'Select workspace';

  return (
    <>
      <div className="relative">
        <Button
          variant="unstyled"
          type="button"
          onClick={() => setIsModalOpen(true)}
          className="inline-flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-2xs text-text-tertiary transition-colors duration-200 hover:bg-surface-hover hover:text-text-primary dark:text-text-dark-tertiary dark:hover:bg-surface-dark-hover dark:hover:text-text-dark-primary"
        >
          <FolderOpen className="h-3 w-3 shrink-0 text-text-quaternary dark:text-text-dark-quaternary" />
          <span className="max-w-[16rem] truncate">{label}</span>
          <svg
            className="h-3 w-3 shrink-0 text-text-quaternary dark:text-text-dark-quaternary"
            viewBox="0 0 16 16"
            fill="currentColor"
          >
            <path d="M4.427 6.427l3.396 3.396a.25.25 0 00.354 0l3.396-3.396A.25.25 0 0011.396 6H4.604a.25.25 0 00-.177.427z" />
          </svg>
        </Button>
      </div>

      <BaseModal isOpen={isModalOpen} onClose={closeModal} size="md" ariaLabel="Select workspace">
        <ModalHeader title="Workspaces" onClose={closeModal} />

        <div className="flex flex-col">
          {showSearch && (
            <div className="px-4 pt-3">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-quaternary dark:text-text-dark-quaternary" />
                <Input
                  variant="unstyled"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search workspaces…"
                  autoFocus
                  className="bg-surface-primary dark:bg-surface-dark-primary h-8 w-full rounded-lg border border-border/50 pl-8 pr-3 text-xs text-text-primary outline-none placeholder:text-text-quaternary focus-visible:border-border-hover dark:border-border-dark/50 dark:text-text-dark-primary dark:placeholder:text-text-dark-quaternary dark:focus-visible:border-border-dark-hover"
                />
              </div>
            </div>
          )}

          <div className="max-h-[20rem] overflow-y-auto px-3 py-2">
            {visibleWorkspaces.length === 0 ? (
              <p className="px-2 py-4 text-center text-xs text-text-quaternary dark:text-text-dark-quaternary">
                {searchQuery ? 'No workspaces found' : 'No workspaces yet'}
              </p>
            ) : (
              <div className="flex flex-col gap-0.5">
                {visibleWorkspaces.map((ws) => (
                  <WorkspaceItem
                    key={ws.id}
                    ws={ws}
                    isSelected={ws.id === selectedWorkspaceId}
                    chatCount={ws.chat_count}
                    isModalOpen={isModalOpen}
                    onSelect={selectWorkspace}
                  />
                ))}
              </div>
            )}
          </div>

          <div className="border-t border-border/50 px-4 py-3 dark:border-border-dark/50">
            {creationMode === 'none' ? (
              <Button
                variant="unstyled"
                type="button"
                onClick={() => setCreationMode('menu')}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs text-text-secondary transition-colors duration-200 hover:bg-surface-hover hover:text-text-primary dark:text-text-dark-secondary dark:hover:bg-surface-dark-hover dark:hover:text-text-dark-primary"
              >
                <Plus className="h-3.5 w-3.5 text-text-quaternary dark:text-text-dark-quaternary" />
                New workspace
              </Button>
            ) : creationMode === 'empty' ? (
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2 text-xs text-text-secondary dark:text-text-dark-secondary">
                  <Box className="h-3.5 w-3.5 text-text-quaternary dark:text-text-dark-quaternary" />
                  Empty workspace
                </div>
                <Input
                  variant="unstyled"
                  value={emptyName}
                  onChange={(e) => setEmptyName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleCreateEmpty();
                  }}
                  placeholder="Workspace name"
                  autoFocus
                  className="bg-surface-primary dark:bg-surface-dark-primary h-8 w-full rounded-lg border border-border/50 px-3 text-xs text-text-primary outline-none placeholder:text-text-quaternary focus-visible:border-border-hover dark:border-border-dark/50 dark:text-text-dark-primary dark:placeholder:text-text-dark-quaternary dark:focus-visible:border-border-dark-hover"
                />
                <ProviderToggle value={sandboxProvider} onChange={setSandboxProvider} />
                <div className="flex items-center justify-end gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setCreationMode('menu');
                      setEmptyName('');
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => void handleCreateEmpty()}
                    isLoading={createWorkspace.isPending}
                  >
                    Create
                  </Button>
                </div>
              </div>
            ) : creationMode === 'git' ? (
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs text-text-secondary dark:text-text-dark-secondary">
                    <GitBranch className="h-3.5 w-3.5 text-text-quaternary dark:text-text-dark-quaternary" />
                    Clone Git repo
                  </div>
                  {hasGitHubToken && (
                    <Button
                      variant="unstyled"
                      type="button"
                      onClick={() => {
                        setShowUrlInput(!showUrlInput);
                        setRepoSearchQuery('');
                        setGitUrl('');
                      }}
                      className="text-2xs text-text-quaternary transition-colors duration-200 hover:text-text-secondary dark:text-text-dark-quaternary dark:hover:text-text-dark-secondary"
                    >
                      {showUrlInput ? 'Browse repos' : 'Paste URL'}
                    </Button>
                  )}
                </div>

                {hasGitHubToken && !showUrlInput ? (
                  <>
                    <div className="relative">
                      <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-quaternary dark:text-text-dark-quaternary" />
                      <Input
                        variant="unstyled"
                        value={repoSearchQuery}
                        onChange={(e) => setRepoSearchQuery(e.target.value)}
                        placeholder="Search repositories…"
                        autoFocus
                        className="bg-surface-primary dark:bg-surface-dark-primary h-8 w-full rounded-lg border border-border/50 pl-8 pr-3 text-xs text-text-primary outline-none placeholder:text-text-quaternary focus-visible:border-border-hover dark:border-border-dark/50 dark:text-text-dark-primary dark:placeholder:text-text-dark-quaternary dark:focus-visible:border-border-dark-hover"
                      />
                    </div>
                    <div className="max-h-[12rem] overflow-y-auto">
                      {createWorkspace.isPending ? (
                        <div className="flex items-center justify-center gap-2 px-2.5 py-6">
                          <Loader2 className="h-3.5 w-3.5 animate-spin text-text-quaternary motion-reduce:animate-none dark:text-text-dark-quaternary" />
                          <span className="text-xs text-text-tertiary dark:text-text-dark-tertiary">
                            Cloning repository…
                          </span>
                        </div>
                      ) : reposLoading ? (
                        <RepoListSkeleton />
                      ) : !reposData?.items.length ? (
                        <p className="px-2.5 py-4 text-center text-2xs text-text-quaternary dark:text-text-dark-quaternary">
                          {debouncedRepoQuery ? 'No repositories found' : 'No repositories'}
                        </p>
                      ) : (
                        <div className="flex flex-col gap-0.5">
                          {reposData.items.map((repo) => (
                            <GitHubRepoItem
                              key={repo.full_name}
                              repo={repo}
                              onSelect={cloneRepo}
                              isCloning={createWorkspace.isPending}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  </>
                ) : (
                  <>
                    <Input
                      variant="unstyled"
                      value={gitUrl}
                      onChange={(e) => setGitUrl(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void handleCloneGit();
                      }}
                      placeholder="https://github.com/org/repo.git"
                      autoFocus
                      disabled={createWorkspace.isPending}
                      className="bg-surface-primary dark:bg-surface-dark-primary h-8 w-full rounded-lg border border-border/50 px-3 font-mono text-xs text-text-primary outline-none placeholder:text-text-quaternary focus-visible:border-border-hover disabled:opacity-50 dark:border-border-dark/50 dark:text-text-dark-primary dark:placeholder:text-text-dark-quaternary dark:focus-visible:border-border-dark-hover"
                    />
                    {!hasGitHubToken && (
                      <p className="text-2xs text-text-quaternary dark:text-text-dark-quaternary">
                        Add a GitHub token in Settings to browse repos
                      </p>
                    )}
                  </>
                )}

                <ProviderToggle value={sandboxProvider} onChange={setSandboxProvider} />
                <div className="flex items-center justify-end gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setCreationMode('menu');
                      setGitUrl('');
                      setRepoSearchQuery('');
                      setShowUrlInput(false);
                    }}
                  >
                    Cancel
                  </Button>
                  {(showUrlInput || !hasGitHubToken) && (
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => void handleCloneGit()}
                      isLoading={createWorkspace.isPending}
                    >
                      Clone
                    </Button>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-0.5">
                <div className="px-2.5 py-1.5">
                  <ProviderToggle value={sandboxProvider} onChange={setSandboxProvider} />
                </div>
                <Button
                  variant="unstyled"
                  type="button"
                  onClick={() => setCreationMode('empty')}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs text-text-secondary transition-colors duration-200 hover:bg-surface-hover hover:text-text-primary dark:text-text-dark-secondary dark:hover:bg-surface-dark-hover dark:hover:text-text-dark-primary"
                >
                  <Box className="h-3.5 w-3.5 text-text-quaternary dark:text-text-dark-quaternary" />
                  Empty workspace
                </Button>
                {isDesktop && (
                  <Button
                    variant="unstyled"
                    type="button"
                    onClick={() => void handleChooseLocal()}
                    disabled={createWorkspace.isPending}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs text-text-secondary transition-colors duration-200 hover:bg-surface-hover hover:text-text-primary disabled:opacity-50 dark:text-text-dark-secondary dark:hover:bg-surface-dark-hover dark:hover:text-text-dark-primary"
                  >
                    <HardDrive className="h-3.5 w-3.5 text-text-quaternary dark:text-text-dark-quaternary" />
                    Local folder
                  </Button>
                )}
                <Button
                  variant="unstyled"
                  type="button"
                  onClick={() => setCreationMode('git')}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs text-text-secondary transition-colors duration-200 hover:bg-surface-hover hover:text-text-primary dark:text-text-dark-secondary dark:hover:bg-surface-dark-hover dark:hover:text-text-dark-primary"
                >
                  <GitBranch className="h-3.5 w-3.5 text-text-quaternary dark:text-text-dark-quaternary" />
                  Clone Git repo
                </Button>
              </div>
            )}
          </div>
        </div>
      </BaseModal>
    </>
  );
}
