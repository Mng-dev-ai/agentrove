import { useMemo } from 'react';
import { Search } from 'lucide-react';
import type { ToolAggregate } from '@/types/tools.types';
import { ToolCard } from '../common/ToolCard/ToolCard';
import { SourceChip } from '../common/SourceChip/SourceChip';
import { SearchLoadingDots } from '../common/SearchLoadingDots/SearchLoadingDots';
import toolIcon from './toolIcon.module.scss';
import styles from './WebSearch.module.scss';

interface WebSearchProps {
  tool: ToolAggregate;
}

interface SearchSource {
  title: string;
  url: string;
}

interface ZaiSearchResult {
  refer: string;
  title: string;
  link: string;
  media: string;
  content: string;
  icon: string;
  publish_date: string;
}

const parseZaiSearchResults = (result: unknown): SearchSource[] => {
  try {
    if (!Array.isArray(result)) {
      return [];
    }

    const firstItem = result[0];
    if (!firstItem || firstItem.type !== 'text' || typeof firstItem.text !== 'string') {
      return [];
    }

    const zaiResults = JSON.parse(firstItem.text) as ZaiSearchResult[];
    return zaiResults.map((item) => ({
      title: item.title,
      url: item.link,
    }));
  } catch {
    return [];
  }
};

const parseClaudeSearchResults = (result: string): SearchSource[] => {
  try {
    const linksMatch = result.match(/Links:\s*(\[[\s\S]*?\])(?=\s*\n|$)/);
    if (linksMatch?.[1]) {
      return JSON.parse(linksMatch[1]) as SearchSource[];
    }
  } catch {
    return [];
  }
  return [];
};

export function WebSearch({ tool }: WebSearchProps) {
  const query = (tool.input?.query as string | undefined) ?? '';
  const toolStatus = tool.status;
  const errorMessage = tool.error;

  const sources: SearchSource[] = useMemo(() => {
    if (typeof tool.result === 'string') {
      const claudeResults = parseClaudeSearchResults(tool.result);
      if (claudeResults.length > 0) {
        return claudeResults;
      }
    }

    const zaiResults = parseZaiSearchResults(tool.result);
    if (zaiResults.length > 0) {
      return zaiResults;
    }

    return [];
  }, [tool.result]);
  return (
    <ToolCard
      icon={<Search className={toolIcon.icon} />}
      status={toolStatus}
      title={(status) => {
        switch (status) {
          case 'completed':
            return `Searched: ${query}`;
          case 'failed':
            return `Search failed: ${query}`;
          default:
            return `Searching: ${query}`;
        }
      }}
      loadingContent={<SearchLoadingDots label="Searching the web" />}
      error={errorMessage}
    >
      {sources.length > 0 && (
        <div>
          <div className={styles.sources}>
            {sources.map((source, index) => (
              <SourceChip key={`${index}-${source.url}`} source={source} index={index} />
            ))}
          </div>
        </div>
      )}
    </ToolCard>
  );
}
