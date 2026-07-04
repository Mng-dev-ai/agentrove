import React from 'react';
import { Globe } from 'lucide-react';
import { FloatingTooltip } from '@/components/ui/FloatingTooltip';
import { Link } from '@/components/ui/primitives/Link';

interface SourceChipProps {
  source: { title: string; url: string };
  index: number;
}

export const SourceChip: React.FC<SourceChipProps> = ({ source, index }) => {
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
    <FloatingTooltip content={source.title} className="flex">
      <Link
        href={source.url}
        variant="unstyled"
        target="_blank"
        rel="noopener noreferrer"
        className="group/chip flex items-center gap-1.5 rounded-md bg-black/5 px-2 py-1 transition-colors duration-150 hover:bg-surface-hover dark:bg-white/5 dark:hover:bg-surface-dark-hover"
      >
        <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded text-2xs font-medium text-text-quaternary dark:text-text-dark-quaternary">
          {faviconUrl ? (
            <img
              src={faviconUrl}
              alt=""
              className="h-3 w-3 rounded-sm"
              onError={(e) => {
                e.currentTarget.style.display = 'none';
                e.currentTarget.nextElementSibling?.classList.remove('hidden');
              }}
            />
          ) : null}
          <Globe
            className={`h-3 w-3 text-text-quaternary dark:text-text-dark-quaternary ${faviconUrl ? 'hidden' : ''}`}
          />
        </span>
        <span className="max-w-32 truncate text-2xs text-text-secondary transition-colors duration-150 group-hover/chip:text-text-primary dark:text-text-dark-tertiary dark:group-hover/chip:text-text-dark-primary">
          {domain}
        </span>
        <span className="text-2xs tabular-nums text-text-quaternary/60 dark:text-text-dark-quaternary/60">
          {index + 1}
        </span>
      </Link>
    </FloatingTooltip>
  );
};
