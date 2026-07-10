import { memo } from 'react';
import { FileSearch } from 'lucide-react';
import type { ToolAggregate } from '@/types/tools.types';
import { extractFilename } from '@/utils/format';
import { ToolCard } from '../common/ToolCard/ToolCard';
import { NumberedContent } from '../common/NumberedContent/NumberedContent';
import { OpenInEditorButton } from '../common/OpenInEditorButton/OpenInEditorButton';
import toolIcon from './toolIcon.module.scss';
import type { GrokReadInput, GrokReadOutput } from './grokPayload';

const ICON = <FileSearch className={toolIcon.icon} />;

export const ReadTool = memo(function ReadTool({ tool }: { tool: ToolAggregate }) {
  const input = tool.input as GrokReadInput | undefined;
  const result = tool.result as GrokReadOutput | undefined;

  const filePath = input?.target_file ?? '';
  const fileName = filePath ? extractFilename(filePath) : tool.title?.trim() || 'file';
  const content = result?.FileContent?.raw_output ?? '';

  return (
    <ToolCard
      icon={ICON}
      status={tool.status}
      title={(status) => {
        switch (status) {
          case 'completed':
            return `Read ${fileName}`;
          case 'failed':
            return `Failed to read ${fileName}`;
          default:
            return `Reading ${fileName}...`;
        }
      }}
      loadingContent="Loading file content..."
      error={tool.error}
      actions={filePath ? <OpenInEditorButton filePath={filePath} /> : null}
    >
      {content && <NumberedContent content={content} />}
    </ToolCard>
  );
});
