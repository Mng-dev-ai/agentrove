import { memo } from 'react';
import { Globe } from 'lucide-react';
import type { ToolAggregate } from '@/types/tools.types';
import { extractDomain } from '@/utils/format';
import { ToolCard } from '../common/ToolCard/ToolCard';
import toolText from '../common/toolText.module.scss';
import toolIcon from './toolIcon.module.scss';
import type { GrokWebFetchInput, GrokWebFetchOutput } from './grokPayload';
import styles from './WebFetchTool.module.scss';

const ICON = <Globe className={toolIcon.icon} />;

export const WebFetchTool = memo(function WebFetchTool({ tool }: { tool: ToolAggregate }) {
  const input = tool.input as GrokWebFetchInput | undefined;
  const result = tool.result as GrokWebFetchOutput | undefined;

  const url = input?.url ?? '';
  const domain = extractDomain(url) || url || 'content';
  const output = result?.Content?.content ?? '';

  return (
    <ToolCard
      icon={ICON}
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
      loadingContent="Fetching content..."
      error={tool.error}
    >
      {(url || output) && (
        <div className={styles.body}>
          {url && <div className={styles.url}>{url}</div>}
          {output && <pre className={toolText['output-pre']}>{output}</pre>}
        </div>
      )}
    </ToolCard>
  );
});
