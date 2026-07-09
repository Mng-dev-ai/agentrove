import { memo } from 'react';
import { FilePlus } from 'lucide-react';
import type { ToolAggregate } from '@/types/tools.types';
import { extractFilename } from '@/utils/format';
import { ToolCard } from '../common/ToolCard/ToolCard';
import { NumberedContent } from '../common/NumberedContent/NumberedContent';
import { OpenInEditorButton } from '../common/OpenInEditorButton/OpenInEditorButton';
import toolIcon from './toolIcon.module.scss';
import type { OpencodeWriteInput } from './opencodePayload';

const ICON = <FilePlus className={toolIcon.icon} />;

const WriteToolInner: React.FC<{ tool: ToolAggregate }> = ({ tool }) => {
  const input = tool.input as OpencodeWriteInput | undefined;
  const filePath = input?.filePath ?? '';
  const fileName = filePath ? extractFilename(filePath) : tool.title?.trim() || 'file';
  const content = input?.content ?? '';

  return (
    <ToolCard
      icon={ICON}
      status={tool.status}
      title={(status) => {
        switch (status) {
          case 'completed':
            return `Wrote ${fileName}`;
          case 'failed':
            return `Failed to write ${fileName}`;
          default:
            return `Writing ${fileName}...`;
        }
      }}
      loadingContent="Writing file..."
      error={tool.error}
      actions={filePath ? <OpenInEditorButton filePath={filePath} /> : null}
    >
      {content && <NumberedContent content={content} />}
    </ToolCard>
  );
};

export const WriteTool = memo(WriteToolInner);
