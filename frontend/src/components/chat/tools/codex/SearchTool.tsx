import { memo } from 'react';
import { FileSearch } from 'lucide-react';
import type { ToolAggregate } from '@/types/tools.types';
import { extractFilename } from '@/utils/format';
import { ToolCard } from '../common/ToolCard/ToolCard';
import { SearchLoadingDots } from '../common/SearchLoadingDots/SearchLoadingDots';
import {
  type ShellLikeInput,
  type ShellLikeOutput,
  extractCommand,
  extractOutput,
  renderCommand,
  renderOutput,
} from './codexShellPayload';
import styles from './SearchTool.module.scss';

const buildSearchLabel = (input: ShellLikeInput | undefined): string => {
  const parsed = input?.parsed_cmd?.[0];
  const query = parsed?.query?.trim() ?? '';
  const path = parsed?.path?.trim() ?? '';

  if (query && path) {
    return `"${query}" in ${extractFilename(path)}`;
  }
  if (query) {
    return `"${query}"`;
  }
  if (path) {
    return extractFilename(path);
  }

  // Codex can stream a generic title like "Searching the web" before parsed_cmd
  // is attached, so fall back to a neutral local-search label here.
  return 'files';
};

export const SearchTool = memo(function SearchTool({ tool }: { tool: ToolAggregate }) {
  const input = tool.input as ShellLikeInput | undefined;
  const result = tool.result as ShellLikeOutput | undefined;
  const searchLabel = buildSearchLabel(input);
  const output = extractOutput(result);
  const command = extractCommand(input);
  const filePath = input?.parsed_cmd?.[0]?.path ?? '';
  // Web search / fuzzy file search send no parsed_cmd but a self-contained
  // title ("Web search: …", "Open page: …", "Search for '…'") — use it verbatim
  // instead of composing a shell-search label around it.
  const adapterTitle = !input?.parsed_cmd?.length ? (tool.title?.trim() ?? '') : '';

  return (
    <ToolCard
      icon={<FileSearch className={styles.icon} />}
      status={tool.status}
      title={(status) => {
        if (adapterTitle) {
          return status === 'failed' ? `${adapterTitle} (failed)` : adapterTitle;
        }
        switch (status) {
          case 'completed':
            return `Searched: ${searchLabel}`;
          case 'failed':
            return `Search failed: ${searchLabel}`;
          default:
            return `Searching: ${searchLabel}`;
        }
      }}
      loadingContent={
        // Codex shell search is a local file search, so the fallback loading
        // copy should not inherit web-specific text.
        <SearchLoadingDots label={adapterTitle || 'Searching files'} />
      }
      error={tool.error}
    >
      {(filePath || command || output) && (
        <div className={styles.body}>
          {filePath && <div className={styles.path}>{filePath}</div>}
          {renderCommand(command)}
          {renderOutput(output)}
        </div>
      )}
    </ToolCard>
  );
});
