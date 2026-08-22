import { memo } from 'react';
import { FileSearch, FolderSearch } from 'lucide-react';
import type { ToolAggregate, ToolEventStatus } from '@/types/tools.types';
import { extractFilename } from '@/utils/format';
import { ToolCard } from '../common/ToolCard/ToolCard';
import type { AntigravitySearchInput } from './antigravityPayload';
import { humanizeToolTitle } from './humanizeToolTitle';
import styles from './SearchTool.module.scss';

const searchTitle = (
  status: ToolEventStatus,
  query: string,
  directoryLabel: string,
  fallback: string,
): string => {
  if (query) {
    switch (status) {
      case 'completed':
        return `Searched '${query}'`;
      case 'failed':
        return `Failed to search '${query}'`;
      default:
        return `Searching '${query}'`;
    }
  }
  if (directoryLabel) {
    switch (status) {
      case 'completed':
        return `Listed ${directoryLabel}`;
      case 'failed':
        return `Failed to list ${directoryLabel}`;
      default:
        return `Listing ${directoryLabel}`;
    }
  }
  return fallback;
};

export const SearchTool = memo(function SearchTool({ tool }: { tool: ToolAggregate }) {
  const input = tool.input as AntigravitySearchInput | undefined;
  const query = input?.query?.trim() ?? '';
  const directoryPath = input?.directory_path ?? '';
  const directoryLabel = directoryPath ? extractFilename(directoryPath) : '';
  const fallback = humanizeToolTitle(tool.title) || 'Search';
  const result = typeof tool.result === 'string' ? tool.result.trim() : '';
  const title = searchTitle(tool.status, query, directoryLabel, fallback);
  const showResult = result && result !== title;

  return (
    <ToolCard
      icon={
        query ? <FileSearch className={styles.icon} /> : <FolderSearch className={styles.icon} />
      }
      status={tool.status}
      title={title}
      loadingContent={query ? 'Searching files...' : 'Listing directory...'}
      error={tool.error}
    >
      {(directoryPath || showResult) && (
        <div className={styles.body}>
          {directoryPath && <div className={styles.path}>{directoryPath}</div>}
          {showResult && <div className={styles.summary}>{result}</div>}
        </div>
      )}
    </ToolCard>
  );
});
