import { memo } from 'react';
import { FileEdit } from 'lucide-react';
import type { ToolAggregate } from '@/types/tools.types';
import { extractFilename } from '@/utils/format';
import { ToolCard } from '../common/ToolCard/ToolCard';
import { DiffView } from '../common/DiffView/DiffView';
import { OpenInEditorButton } from '../common/OpenInEditorButton/OpenInEditorButton';
import { buildUnifiedDiff } from '../common/buildUnifiedDiff';
import toolIcon from './toolIcon.module.scss';
import type { OpencodeEditInput } from './opencodePayload';

const ICON = <FileEdit className={toolIcon.icon} />;

const EditToolInner: React.FC<{ tool: ToolAggregate }> = ({ tool }) => {
  const input = tool.input as OpencodeEditInput | undefined;
  const filePath = input?.filePath ?? '';
  const fileName = filePath ? extractFilename(filePath) : tool.title?.trim() || 'file';
  const oldText = input?.oldString ?? '';
  const newText = input?.newString ?? '';
  const diff = oldText || newText ? buildUnifiedDiff(oldText, newText) : '';

  return (
    <ToolCard
      icon={ICON}
      status={tool.status}
      title={(status) => {
        switch (status) {
          case 'completed':
            return `Edited ${fileName}`;
          case 'failed':
            return `Failed to edit ${fileName}`;
          default:
            return `Editing ${fileName}...`;
        }
      }}
      loadingContent="Applying changes..."
      error={tool.error}
      actions={filePath ? <OpenInEditorButton filePath={filePath} /> : null}
    >
      {diff && <DiffView diff={diff} />}
    </ToolCard>
  );
};

export const EditTool = memo(EditToolInner);
