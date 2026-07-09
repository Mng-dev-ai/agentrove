import { memo } from 'react';
import { FileSearch, FolderSearch, Globe } from 'lucide-react';
import type { ToolAggregate } from '@/types/tools.types';
import { ToolCard } from '../common/ToolCard/ToolCard';
import { SearchLoadingDots } from '../common/SearchLoadingDots/SearchLoadingDots';
import type { CursorSearchOutput } from './cursorPayload';
import styles from './SearchTool.module.scss';

const ICON_CLASS = styles.icon;

const SearchToolInner: React.FC<{ tool: ToolAggregate }> = ({ tool }) => {
  const result = tool.result as CursorSearchOutput | undefined;
  const title = tool.title?.trim() || 'search';

  // Cursor reports its web search with the same `search` kind as grep/glob,
  // distinguished only by the title "Web Search". rawInput is empty (no query
  // to show) and the result carries just a referenceCount — the findings stream
  // back as assistant text — so render a minimal web variant instead of the
  // file-search "Found N files" copy.
  if (/^web search$/i.test(title)) {
    const refs = result?.referenceCount;
    return (
      <ToolCard
        icon={<Globe className={ICON_CLASS} />}
        status={tool.status}
        title={(status) => {
          switch (status) {
            case 'completed':
              return typeof refs === 'number'
                ? `Searched the web · ${refs} reference${refs === 1 ? '' : 's'}`
                : 'Searched the web';
            case 'failed':
              return 'Web search failed';
            default:
              return 'Searching the web...';
          }
        }}
        loadingContent={<SearchLoadingDots label="Searching the web" />}
        error={tool.error}
      />
    );
  }

  // Cursor uses the same `search` kind for grep-style content search (title
  // "grep") and file-name glob search (title "Find"). totalMatches is present
  // for grep, totalFiles for Find — use whichever is defined.
  const isGlob = /^find$/i.test(title);
  const count = result?.totalMatches ?? result?.totalFiles;
  const truncated = result?.truncated ?? false;

  const icon = isGlob ? (
    <FolderSearch className={ICON_CLASS} />
  ) : (
    <FileSearch className={ICON_CLASS} />
  );

  return (
    <ToolCard
      icon={icon}
      status={tool.status}
      title={(status) => {
        switch (status) {
          case 'completed': {
            if (typeof count !== 'number') return `Searched with ${title}`;
            const noun = isGlob ? 'file' : 'match';
            const plural = count === 1 ? '' : 'es';
            const suffix = truncated ? '+' : '';
            return `Found ${count}${suffix} ${noun}${isGlob ? (count === 1 ? '' : 's') : plural}`;
          }
          case 'failed':
            return `Search failed: ${title}`;
          default:
            return `Searching with ${title}...`;
        }
      }}
      loadingContent={<SearchLoadingDots label={isGlob ? 'Finding files' : 'Searching files'} />}
      error={tool.error}
    />
  );
};

export const SearchTool = memo(SearchToolInner);
