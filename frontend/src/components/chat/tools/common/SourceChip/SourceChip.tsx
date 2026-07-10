import clsx from 'clsx';
import { Globe } from 'lucide-react';
import { FloatingTooltip } from '@/components/ui/FloatingTooltip/FloatingTooltip';
import { Link } from '@/components/ui/primitives/Link/Link';
import styles from './SourceChip.module.scss';

interface SourceChipProps {
  source: { title: string; url: string };
  index: number;
}

export function SourceChip({ source, index }: SourceChipProps) {
  let domain = '';
  let faviconUrl: string | null = null;

  try {
    const urlObj = new URL(source.url);
    domain = urlObj.hostname.replace('www.', '');
    faviconUrl = `https://www.google.com/s2/favicons?sz=32&domain=${domain}`;
  } catch {
    domain = source.url;
  }

  return (
    <FloatingTooltip content={source.title} className={styles.tooltip}>
      <Link
        href={source.url}
        variant="unstyled"
        target="_blank"
        rel="noopener noreferrer"
        className={styles.chip}
      >
        <span className={styles.favicon}>
          {faviconUrl ? (
            <img
              src={faviconUrl}
              alt=""
              className={styles['favicon-img']}
              onError={(e) => {
                e.currentTarget.style.display = 'none';
                e.currentTarget.nextElementSibling?.classList.remove('hidden');
              }}
            />
          ) : null}
          <Globe className={clsx(styles.globe, faviconUrl && 'hidden')} />
        </span>
        <span className={styles.domain}>{domain}</span>
        <span className={styles.index}>{index + 1}</span>
      </Link>
    </FloatingTooltip>
  );
}
