import { memo } from 'react';
import { FileSearch } from 'lucide-react';
import type { ToolAggregate } from '@/types/tools.types';
import { ToolCard } from '../common/ToolCard/ToolCard';
import { SearchLoadingDots } from '../common/SearchLoadingDots/SearchLoadingDots';
import toolText from '../common/toolText.module.scss';
import toolIcon from './toolIcon.module.scss';
import type { GrokGrepInput, GrokGrepOutput } from './grokPayload';

const ICON = <FileSearch className={toolIcon.icon} />;

export const GrepTool = memo(function GrepTool({ tool }: { tool: ToolAggregate }) {
  const input = tool.input as GrokGrepInput | undefined;
  const result = tool.result as GrokGrepOutput | undefined;

  const pattern = input?.pattern ?? 'pattern';
  const matches = result?.match_count;
  const output = result?.stdout ?? '';

  return (
    <ToolCard
      icon={ICON}
      status={tool.status}
      title={(status) => {
        switch (status) {
          case 'completed': {
            if (typeof matches !== 'number') return `Searched for "${pattern}"`;
            return `Found ${matches} match${matches === 1 ? '' : 'es'}`;
          }
          case 'failed':
            return `Search failed: ${pattern}`;
          default:
            return `Searching for "${pattern}"...`;
        }
      }}
      loadingContent={<SearchLoadingDots label="Searching files" />}
      error={tool.error}
    >
      {output && typeof matches === 'number' && matches > 0 && (
        <pre className={toolText['output-pre']}>{output}</pre>
      )}
    </ToolCard>
  );
});
