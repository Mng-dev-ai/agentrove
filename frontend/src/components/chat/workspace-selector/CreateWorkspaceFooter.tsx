import { useState, useCallback } from 'react';
import toast from 'react-hot-toast';
import { Search, GitBranch, Plus, Box, HardDrive, Loader2 } from 'lucide-react';
import clsx from 'clsx';
import { Button } from '@/components/ui/primitives/Button/Button';
import { Input } from '@/components/ui/primitives/Input/Input';
import { useCreateWorkspaceMutation } from '@/hooks/queries/useWorkspaceQueries';
import { useSettingsQuery } from '@/hooks/queries/useSettingsQueries';
import { useGitHubReposQuery } from '@/hooks/queries/useGitHubQueries';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { isDesktopApp } from '@/utils/platform';
import { open } from '@tauri-apps/plugin-dialog';
import { CreateWorkspaceProviderToggle } from './CreateWorkspaceProviderToggle';
import { CreateWorkspaceGitHubRepoItem } from './CreateWorkspaceGitHubRepoItem';
import { CreateWorkspaceRepoListSkeleton } from './CreateWorkspaceRepoListSkeleton';
import styles from './CreateWorkspaceFooter.module.scss';

type CreationMode = 'none' | 'menu' | 'empty' | 'git';

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
  const debouncedRepoQuery = useDebouncedValue(repoSearchQuery, 300);
  const [showUrlInput, setShowUrlInput] = useState(false);

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
        className={styles['option-button']}
      >
        <Plus className={styles['option-icon']} />
        New workspace
      </Button>
    );
  }

  if (creationMode === 'empty') {
    return (
      <div className={styles.form}>
        <div className={styles['form-label']}>
          <Box className={styles['option-icon']} />
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
          className={styles['text-input']}
        />
        <CreateWorkspaceProviderToggle value={sandboxProvider} onChange={setSandboxProvider} />
        <div className={styles.actions}>
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
      <div className={styles.form}>
        <div className={styles['form-header']}>
          <div className={styles['form-label']}>
            <GitBranch className={styles['option-icon']} />
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
              className={styles['toggle-mode-button']}
            >
              {showUrlInput ? 'Browse repos' : 'Paste URL'}
            </Button>
          )}
        </div>

        {hasGitHubToken && !showUrlInput ? (
          <>
            <div className={styles['search-field']}>
              <Search className={styles['search-icon']} />
              <Input
                variant="unstyled"
                value={repoSearchQuery}
                onChange={(e) => setRepoSearchQuery(e.target.value)}
                placeholder="Search repositories…"
                autoFocus
                className={clsx(styles['text-input'], styles['text-input--search'])}
              />
            </div>
            <div className={styles['repo-list']}>
              {createWorkspace.isPending ? (
                <div className={styles['repo-loading']}>
                  <Loader2 className={styles['repo-loading-icon']} />
                  <span className={styles['repo-loading-label']}>Cloning repository…</span>
                </div>
              ) : reposLoading ? (
                <CreateWorkspaceRepoListSkeleton />
              ) : !reposData?.items.length ? (
                <p className={styles['repo-empty']}>
                  {debouncedRepoQuery ? 'No repositories found' : 'No repositories'}
                </p>
              ) : (
                <div className={styles['repo-items']}>
                  {reposData.items.map((repo) => (
                    <CreateWorkspaceGitHubRepoItem
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
              className={clsx(styles['text-input'], styles['text-input--mono'])}
            />
            {!hasGitHubToken && (
              <p className={styles['helper-text']}>
                Add a GitHub token in Settings to browse repos
              </p>
            )}
          </>
        )}

        <CreateWorkspaceProviderToggle value={sandboxProvider} onChange={setSandboxProvider} />
        <div className={styles.actions}>
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
    <div className={styles.menu}>
      <div className={styles['menu-provider']}>
        <CreateWorkspaceProviderToggle value={sandboxProvider} onChange={setSandboxProvider} />
      </div>
      <Button
        variant="unstyled"
        type="button"
        onClick={() => setCreationMode('empty')}
        className={styles['option-button']}
      >
        <Box className={styles['option-icon']} />
        Empty workspace
      </Button>
      {isDesktop && (
        <Button
          variant="unstyled"
          type="button"
          onClick={() => void handleChooseLocal()}
          disabled={createWorkspace.isPending}
          className={styles['option-button']}
        >
          <HardDrive className={styles['option-icon']} />
          Local folder
        </Button>
      )}
      <Button
        variant="unstyled"
        type="button"
        onClick={() => setCreationMode('git')}
        className={styles['option-button']}
      >
        <GitBranch className={styles['option-icon']} />
        Clone Git repo
      </Button>
    </div>
  );
}
