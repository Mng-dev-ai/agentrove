import { memo } from 'react';
import { FileSearch } from 'lucide-react';
import type { ToolAggregate } from '@/types/tools.types';
import { extractFilename } from '@/utils/format';
import { ToolCard } from '../common/ToolCard/ToolCard';
import { ToolImages } from '../common/ToolImages/ToolImages';
import { NumberedContent } from '../common/NumberedContent/NumberedContent';
import { OpenInEditorButton } from '../common/OpenInEditorButton/OpenInEditorButton';
import toolIcon from './toolIcon.module.scss';
import type { OpencodeReadInput, OpencodeOutput } from './opencodePayload';

const ICON = <FileSearch className={toolIcon.icon} />;
// v2 output: "Read file <path>, lines a-b" header, then "N: <line>" rows.
const READ_HEADER = /^Read file .*\n/;
const LINE_NUMBER_PREFIX = /^(\d+): /;

export const ReadTool = memo(function ReadTool({ tool }: { tool: ToolAggregate }) {
  const input = tool.input as OpencodeReadInput | undefined;
  const result = tool.result as OpencodeOutput | undefined;

  const filePath = input?.path ?? input?.filePath ?? '';
  const fileName = filePath ? extractFilename(filePath) : tool.title?.trim() || 'file';
  const content = (result?.output ?? '').replace(READ_HEADER, '');

  if (tool.status !== 'failed' && tool.images?.length) {
    return <ToolImages toolId={tool.id} fileName={fileName} images={tool.images} />;
  }

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
      error={tool.error}
      actions={filePath ? <OpenInEditorButton filePath={filePath} /> : null}
    >
      {content && <NumberedContent content={content} prefixPattern={LINE_NUMBER_PREFIX} />}
    </ToolCard>
  );
});
