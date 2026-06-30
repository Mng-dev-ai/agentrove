import { useState, useCallback, useEffect, memo } from 'react';
import toast from 'react-hot-toast';
import { Search, GitBranch, Plus, Box, HardDrive, Lock, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button';
import { Input } from '@/components/ui/primitives/Input';
import { useCreateWorkspaceMutation } from '@/hooks/queries/useWorkspaceQueries';
import { useSettingsQuery } from '@/hooks/queries/useSettingsQueries';
import { useGitHubReposQuery } from '@/hooks/queries/useGitHubQueries';
import type { GitHubRepo } from '@/types/github.types';
import { formatRelativeTime } from '@/utils/date';
import { cn } from '@/utils/cn';
import { isDesktopApp } from '@/utils/platform';
import { open } from '@tauri-apps/plugin-dialog';

const SKELETON_ITEMS = [0, 1, 2];

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

// Creation flows for local workspaces: empty, local folder (desktop only), and
// git clone (browse GitHub repos when a token is configured, otherwise paste a URL).
// onCreated selects the new workspace and dismisses the picker.
export function CreateWorkspaceFooter({ onCreated }: { onCreated: (id: string) => void }) {
  const isDesktop = isDesktopApp();
  const { data: settings } = useSettingsQuery({ enabled: true });
  const createWorkspace = useCreateWorkspaceMutation();

  const hasGitHubToken = Boolean(settings?.github_personal_access_token);

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

  const handleCreateEmpty = useCallback(async () => {
    const name = emptyName.trim() || 'Untitled';
    try {
      const workspace = await createWorkspace.mutateAsync({
        name,
        source_type: 'empty',
        sandbox_provider: sandboxProvider,
      });
      onCreated(workspace.id);
      toast.success('Workspace created');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to create workspace');
    }
  }, [createWorkspace, emptyName, sandboxProvider, onCreated]);

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
      onCreated(workspace.id);
      toast.success('Workspace created');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to create workspace');
    }
  }, [createWorkspace, sandboxProvider, onCreated]);

  const cloneRepo = useCallback(
    async (url: string, name: string) => {
      try {
        const workspace = await createWorkspace.mutateAsync({
          name,
          source_type: 'git',
          git_url: url,
          sandbox_provider: sandboxProvider,
        });
        onCreated(workspace.id);
        toast.success('Repository cloned');
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to clone repository');
      }
    },
    [createWorkspace, sandboxProvider, onCreated],
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

  if (creationMode === 'none') {
    return (
      <Button
        variant="unstyled"
        type="button"
        onClick={() => setCreationMode('menu')}
        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs text-text-secondary transition-colors duration-200 hover:bg-surface-hover hover:text-text-primary dark:text-text-dark-secondary dark:hover:bg-surface-dark-hover dark:hover:text-text-dark-primary"
      >
        <Plus className="h-3.5 w-3.5 text-text-quaternary dark:text-text-dark-quaternary" />
        New workspace
      </Button>
    );
  }

  if (creationMode === 'empty') {
    return (
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
    );
  }

  if (creationMode === 'git') {
    return (
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
    );
  }

  return (
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
  );
}
