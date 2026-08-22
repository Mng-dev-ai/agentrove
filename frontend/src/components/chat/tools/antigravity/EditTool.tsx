import { memo } from 'react';
import { FileEdit, FilePlus } from 'lucide-react';
import type { ToolAggregate } from '@/types/tools.types';
import { extractFilename } from '@/utils/format';
import { ToolCard } from '../common/ToolCard/ToolCard';
import { DiffView } from '../common/DiffView/DiffView';
import { NumberedContent } from '../common/NumberedContent/NumberedContent';
import { OpenInEditorButton } from '../common/OpenInEditorButton/OpenInEditorButton';
import { buildUnifiedDiff } from '../common/buildUnifiedDiff';
import type {
  AntigravityDiffBlock,
  AntigravityEditInput,
  AntigravityEditOutput,
} from './antigravityPayload';
import { humanizeToolTitle } from './humanizeToolTitle';
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
  const input = tool.input as AntigravityEditInput | undefined;
  const result = tool.result as AntigravityEditOutput | string | undefined;
  const summary = typeof result === 'string' ? result.trim() : '';
  const diffs = typeof result === 'object' && result ? (result.diffs ?? []) : [];
  const first = diffs[0];
  const operation = first
    ? classifyEdit(first)
    : /^(create|add)\b/i.test(summary)
      ? 'create'
      : 'edit';
  const filePath = first?.path ?? input?.file_path ?? input?.target_file ?? '';
  const fileName = filePath ? extractFilename(filePath) : humanizeToolTitle(tool.title) || 'file';
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
        if (status === 'completed' && summary) return summary;
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
