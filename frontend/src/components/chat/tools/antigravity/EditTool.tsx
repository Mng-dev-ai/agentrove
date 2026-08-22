import { memo } from 'react';
import { FileEdit, FilePlus } from 'lucide-react';
import type { ToolAggregate } from '@/types/tools.types';
import { extractFilename } from '@/utils/format';
import { ToolCard } from '../common/ToolCard/ToolCard';
import { DiffView } from '../common/DiffView/DiffView';
import { NumberedContent } from '../common/NumberedContent/NumberedContent';
import { OpenInEditorButton } from '../common/OpenInEditorButton/OpenInEditorButton';
import { buildUnifiedDiff } from '../common/buildUnifiedDiff';
import type { AntigravityDiffBlock, AntigravityEditOutput } from './antigravityPayload';
import styles from './EditTool.module.scss';

const classifyEdit = (block: AntigravityDiffBlock): 'create' | 'edit' =>
  !block.oldText ? 'create' : 'edit';

function DiffEntry({ block }: { block: AntigravityDiffBlock }) {
  if (classifyEdit(block) === 'create') {
    return <NumberedContent content={block.newText ?? ''} />;
  }
  return <DiffView diff={buildUnifiedDiff(block.oldText ?? '', block.newText ?? '')} />;
}

export const EditTool = memo(function EditTool({ tool }: { tool: ToolAggregate }) {
  const result = tool.result as AntigravityEditOutput | undefined;
  const diffs = result?.diffs ?? [];
  const first = diffs[0];
  const operation = first ? classifyEdit(first) : 'edit';
  const filePath = first?.path ?? '';
  const fileName = filePath ? extractFilename(filePath) : tool.title?.trim() || 'file';
  const target = diffs.length > 1 ? `${diffs.length} files` : fileName;

  return (
    <ToolCard
      icon={
        operation === 'create' ? (
          <FilePlus className={styles.icon} />
        ) : (
          <FileEdit className={styles.icon} />
        )
      }
      status={tool.status}
      title={(status) => {
        if (operation === 'create') {
          switch (status) {
            case 'completed':
              return `Created ${target}`;
            case 'failed':
              return `Failed to create ${target}`;
            default:
              return `Creating ${target}`;
          }
        }
        switch (status) {
          case 'completed':
            return `Edited ${target}`;
          case 'failed':
            return `Failed to edit ${target}`;
          default:
            return `Editing ${target}`;
        }
      }}
      loadingContent={operation === 'create' ? 'Creating file...' : 'Applying changes...'}
      error={tool.error}
      actions={filePath ? <OpenInEditorButton filePath={filePath} /> : null}
    >
      {diffs.length > 0 && (
        <div className={styles.list}>
          {diffs.map((block, index) => (
            <div key={block.path ?? index}>
              {diffs.length > 1 && block.path && (
                <div className={styles['file-label']}>{extractFilename(block.path)}</div>
              )}
              <DiffEntry block={block} />
            </div>
          ))}
        </div>
      )}
    </ToolCard>
  );
});
