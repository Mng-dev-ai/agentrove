import { memo } from 'react';
import { FileEdit } from 'lucide-react';
import type { ToolAggregate } from '@/types/tools.types';
import { extractFilename } from '@/utils/format';
import { ToolCard } from '../common/ToolCard/ToolCard';
import { DiffView } from '../common/DiffView/DiffView';
import { OpenInEditorButton } from '../common/OpenInEditorButton/OpenInEditorButton';
import { buildUnifiedDiff } from '../common/buildUnifiedDiff';
import toolIcon from './toolIcon.module.scss';
import type { GrokEditInput } from './grokPayload';

const ICON = <FileEdit className={toolIcon.icon} />;

export const EditTool = memo(function EditTool({ tool }: { tool: ToolAggregate }) {
  const input = tool.input as GrokEditInput | undefined;
  const filePath = input?.file_path ?? '';
  const fileName = filePath ? extractFilename(filePath) : tool.title?.trim() || 'file';
  const oldText = input?.old_string ?? '';
  const newText = input?.new_string ?? '';
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
});
