import { memo } from 'react';
import { Globe } from 'lucide-react';
import type { ToolAggregate } from '@/types/tools.types';
import { extractDomain, formatResult } from '@/utils/format';
import { ToolCard } from '../common/ToolCard/ToolCard';
import toolText from '../common/toolText.module.scss';
import toolIcon from './toolIcon.module.scss';
import styles from './WebFetchTool.module.scss';

interface WebFetchInput {
  url: string;
  prompt: string;
}

export const WebFetchTool = memo(function WebFetchTool({ tool }: { tool: ToolAggregate }) {
  const input = tool.input as WebFetchInput | undefined;
  const url = input?.url ?? '';
  const prompt = input?.prompt ?? '';

  const domain = extractDomain(url) || 'content';
  const result = formatResult(tool.result);

  return (
    <ToolCard
      icon={<Globe className={toolIcon.icon} />}
      status={tool.status}
      title={(status) => {
        switch (status) {
          case 'completed':
            return `Fetched: ${domain}`;
          case 'failed':
            return `Failed to fetch: ${domain}`;
          default:
            return `Fetching: ${domain}`;
        }
      }}
      loadingContent="Fetching content\u2026"
      error={tool.error}
    >
      {(url || prompt || result) && (
        <div className={styles.details}>
          {url && <div className={styles.url}>{url}</div>}
          {prompt && <p className={styles.prompt}>{prompt}</p>}
          {result && <pre className={toolText['output-pre']}>{result}</pre>}
        </div>
      )}
    </ToolCard>
  );
});
