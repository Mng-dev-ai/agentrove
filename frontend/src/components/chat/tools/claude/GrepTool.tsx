import { memo } from 'react';
import { FileSearch } from 'lucide-react';
import type { ToolAggregate } from '@/types/tools.types';
import { formatResult } from '@/utils/format';
import { ToolCard } from '../common/ToolCard/ToolCard';
import toolText from '../common/toolText.module.scss';
import toolIcon from './toolIcon.module.scss';

type OutputMode = 'content' | 'files_with_matches' | 'count';

interface GrepInput {
  pattern: string;
  path?: string;
  output_mode?: OutputMode;
  glob?: string;
  type?: string;
}

const MODE_LABELS: Record<OutputMode, string> = {
  content: 'lines',
  files_with_matches: 'files',
  count: 'counts',
};

export const GrepTool = memo(function GrepTool({ tool }: { tool: ToolAggregate }) {
  const input = tool.input as GrepInput | undefined;
  const pattern = input?.pattern ?? '';
  const outputMode = input?.output_mode ?? 'files_with_matches';

  const result = formatResult(tool.result);
  const modeLabel = MODE_LABELS[outputMode];

  return (
    <ToolCard
      icon={<FileSearch className={toolIcon.icon} />}
      status={tool.status}
      title={(status) => {
        switch (status) {
          case 'completed':
            return `Searched: "${pattern}" (${modeLabel})`;
          case 'failed':
            return `Failed to search: "${pattern}" (${modeLabel})`;
          default:
            return `Searching: "${pattern}" (${modeLabel})`;
        }
      }}
      loadingContent="Searching..."
      error={tool.error}
    >
      {result && <pre className={toolText['output-pre']}>{result}</pre>}
    </ToolCard>
  );
});
