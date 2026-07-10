import { memo } from 'react';
import { FileEdit, FilePlus, FileMinus } from 'lucide-react';
import type { ToolAggregate } from '@/types/tools.types';
import { extractFilename } from '@/utils/format';
import { ToolCard } from '../common/ToolCard/ToolCard';
import { DiffView } from '../common/DiffView/DiffView';
import { NumberedContent } from '../common/NumberedContent/NumberedContent';
import { OpenInEditorButton } from '../common/OpenInEditorButton/OpenInEditorButton';
import { buildUnifiedDiff } from '../common/buildUnifiedDiff';
import type { CursorDiffBlock, CursorEditOutput } from './cursorPayload';
import styles from './EditTool.module.scss';

type EditOp = 'add' | 'update' | 'delete';

const ICON_BY_OP: Record<EditOp, React.ReactNode> = {
  add: <FilePlus className={styles.icon} />,
  delete: <FileMinus className={styles.icon} />,
  update: <FileEdit className={styles.icon} />,
};

const classifyOp = (block: CursorDiffBlock): EditOp => {
  // ACP diff semantics: empty oldText = create, empty newText = delete,
  // both populated = update. Treat undefined like empty since Cursor can omit
  // the field entirely for create/delete cases.
  const hasOld = !!block.oldText;
  const hasNew = !!block.newText;
  if (!hasOld && hasNew) return 'add';
  if (hasOld && !hasNew) return 'delete';
  return 'update';
};

function DiffEntry({ block }: { block: CursorDiffBlock }) {
  const op = classifyOp(block);
  if (op === 'add') {
    return <NumberedContent content={block.newText ?? ''} />;
  }
  return <DiffView diff={buildUnifiedDiff(block.oldText ?? '', block.newText ?? '')} />;
}

export const EditTool = memo(function EditTool({ tool }: { tool: ToolAggregate }) {
  const result = tool.result as CursorEditOutput | undefined;
  const diffs = result?.diffs ?? [];

  const first = diffs[0];
  const op = first ? classifyOp(first) : 'update';
  const filePath = first?.path ?? '';
  const fileName = filePath ? extractFilename(filePath) : tool.title?.trim() || 'file';
  const target = diffs.length > 1 ? `${diffs.length} files` : fileName;

  return (
    <ToolCard
      icon={ICON_BY_OP[op]}
      status={tool.status}
      title={(status) => {
        const { label, verb } =
          op === 'add'
            ? { label: 'Created', verb: 'Creating' }
            : op === 'delete'
              ? { label: 'Deleted', verb: 'Deleting' }
              : { label: 'Edited', verb: 'Editing' };
        switch (status) {
          case 'completed':
            return `${label} ${target}`;
          case 'failed':
            return `Failed to ${verb.toLowerCase()} ${target}`;
          default:
            return `${verb} ${target}`;
        }
      }}
      loadingContent={
        op === 'add'
          ? 'Creating file...'
          : op === 'delete'
            ? 'Removing file...'
            : 'Applying changes...'
      }
      error={tool.error}
      actions={filePath ? <OpenInEditorButton filePath={filePath} /> : null}
    >
      {diffs.length > 0 && (
        <div className={styles.list}>
          {diffs.map((block, idx) => (
            <div key={block.path ?? idx}>
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
