import { ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button/Button';
import { openExternalUrl } from '@/utils/openExternal';
import styles from './CreatePRExistingBanner.module.scss';

interface CreatePRExistingBannerProps {
  pr: { number: number; title: string; html_url: string };
}

export function CreatePRExistingBanner({ pr }: CreatePRExistingBannerProps) {
  return (
    <div className={styles['create-pr-existing-banner']}>
      <div className={styles.info}>
        <p className={styles.title}>PR #{pr.number} already exists for this branch</p>
        <p className={styles.subtitle}>{pr.title}</p>
      </div>
      <Button
        variant="unstyled"
        type="button"
        onClick={() => openExternalUrl(pr.html_url)}
        className={styles['view-button']}
      >
        View on GitHub
        <ExternalLink className={styles['view-icon']} />
      </Button>
    </div>
  );
}
