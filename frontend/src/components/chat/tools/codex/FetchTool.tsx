import { memo, useMemo } from 'react';
import { Globe } from 'lucide-react';
import type { ToolAggregate } from '@/types/tools.types';
import { extractDomain, formatResult } from '@/utils/format';
import { ToolCard } from '../common/ToolCard/ToolCard';
import { SourceChip } from '../common/SourceChip/SourceChip';
import toolText from '../common/toolText.module.scss';
import styles from './FetchTool.module.scss';

interface FetchAction {
  type: 'open_page' | 'find_in_page';
  url?: string;
  pattern?: string;
}

interface FetchInput {
  action?: FetchAction;
}

interface PageSource {
  title: string;
  url: string;
}

const extractSources = (input: FetchInput | undefined): PageSource[] => {
  const action = input?.action;
  if (!action) return [];

  if (action.type === 'open_page' && action.url) {
    return [{ title: extractDomain(action.url) || action.url, url: action.url }];
  }

  return [];
};

export const FetchTool = memo(function FetchTool({ tool }: { tool: ToolAggregate }) {
  const input = tool.input as FetchInput | undefined;
  const url = input?.action?.url ?? '';
  const pattern = input?.action?.pattern ?? '';
  const domain = extractDomain(url) || 'content';
  const result = formatResult(tool.result);

  const sources = useMemo(() => extractSources(input), [input]);

  return (
    <ToolCard
      icon={<Globe className={styles.icon} />}
      status={tool.status}
      title={(status) => {
        const fetchLabel = pattern || domain;
        switch (status) {
          case 'completed':
            return `Fetched: ${fetchLabel}`;
          case 'failed':
            return `Failed to fetch: ${fetchLabel}`;
          default:
            return `Fetching: ${fetchLabel}`;
        }
      }}
      loadingContent="Fetching content..."
      error={tool.error}
    >
      {(sources.length > 0 || url || pattern || result) && (
        <div className={sources.length > 0 ? styles.sources : styles.fallback}>
          {sources.length > 0 ? (
            sources.map((source, index) => (
              <SourceChip key={`${index}-${source.url}`} source={source} index={index} />
            ))
          ) : (
            <>
              {url && <div className={styles.url}>{url}</div>}
              {pattern && <p className={styles.pattern}>{pattern}</p>}
              {result && <pre className={toolText['output-pre']}>{result}</pre>}
            </>
          )}
        </div>
      )}
    </ToolCard>
  );
});
