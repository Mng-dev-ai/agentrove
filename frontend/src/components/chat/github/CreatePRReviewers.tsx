import { Button } from '@/components/ui/primitives/Button/Button';
import type { GitHubCollaborator } from '@/types/github.types';
import styles from './CreatePRReviewers.module.scss';

interface CreatePRReviewersProps {
  collaborators: GitHubCollaborator[] | undefined;
  selected: string[];
  onToggle: (login: string) => void;
}

export function CreatePRReviewers({ collaborators, selected, onToggle }: CreatePRReviewersProps) {
  return (
    <div className={styles['create-pr-reviewers']}>
      {!collaborators || collaborators.length === 0 ? (
        <span className={styles.empty}>No collaborators</span>
      ) : (
        collaborators.map((c) => (
          <Button
            variant="unstyled"
            key={c.login}
            type="button"
            onClick={() => onToggle(c.login)}
            className={selected.includes(c.login) ? styles['chip-selected'] : styles.chip}
          >
            {c.login}
          </Button>
        ))
      )}
    </div>
  );
}
