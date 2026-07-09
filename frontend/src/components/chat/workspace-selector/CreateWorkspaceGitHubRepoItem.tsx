import { memo } from 'react';
import { GitBranch, Lock } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button/Button';
import type { GitHubRepo } from '@/types/github.types';
import { formatRelativeTime } from '@/utils/date';
import styles from './CreateWorkspaceGitHubRepoItem.module.scss';

export const CreateWorkspaceGitHubRepoItem = memo(function CreateWorkspaceGitHubRepoItem({
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
      className={styles['github-repo-item']}
    >
      <GitBranch className={styles.icon} />
      <div className={styles.content}>
        <div className={styles['header-row']}>
          <span className={styles.name}>{repo.full_name}</span>
          {repo.private && (
            <span className={styles['private-badge']}>
              <Lock className={styles['lock-icon']} />
              private
            </span>
          )}
        </div>
        {repo.description && <p className={styles.description}>{repo.description}</p>}
        <div className={styles['meta-row']}>
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
