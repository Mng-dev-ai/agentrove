import { memo } from 'react';
import { BookOpen } from 'lucide-react';
import type { ToolAggregate } from '@/types/tools.types';
import { extractFilename } from '@/utils/format';
import { ToolCard } from '../common/ToolCard/ToolCard';
import toolText from '../common/toolText.module.scss';
import toolIcon from './toolIcon.module.scss';
import styles from './NotebookEditTool.module.scss';

type EditMode = 'replace' | 'insert' | 'delete';

interface NotebookEditInput {
  notebook_path: string;
  new_source: string;
  cell_id?: string;
  cell_type?: 'code' | 'markdown';
  edit_mode?: EditMode;
}

const NotebookEditToolInner: React.FC<{ tool: ToolAggregate }> = ({ tool }) => {
  const input = tool.input as NotebookEditInput | undefined;
  const notebookPath = input?.notebook_path ?? '';
  const editMode = input?.edit_mode ?? 'replace';
  const newSource = input?.new_source ?? '';
  const cellId = input?.cell_id;
  const cellType = input?.cell_type;

  const filename = extractFilename(notebookPath);
  const inProgressLabels: Record<EditMode, string> = {
    replace: 'Editing cell in',
    insert: 'Inserting cell in',
    delete: 'Deleting cell in',
  };
  const completedLabels: Record<EditMode, string> = {
    replace: 'Edited cell in',
    insert: 'Inserted cell in',
    delete: 'Deleted cell in',
  };

  return (
    <ToolCard
      icon={<BookOpen className={toolIcon.icon} />}
      status={tool.status}
      title={(status) => {
        const suffix = filename ? ` ${filename}` : '';
        switch (status) {
          case 'completed':
            return `${completedLabels[editMode] ?? editMode}${suffix}`;
          case 'failed':
            return `Failed to ${editMode} cell in${suffix}`;
          default:
            return `${inProgressLabels[editMode] ?? editMode}${suffix}`;
        }
      }}
      loadingContent="Editing notebook..."
      error={tool.error}
    >
      {(notebookPath || newSource || cellId || cellType) && (
        <div className={styles.details}>
          {notebookPath && <div className={styles.path}>{notebookPath}</div>}
          {(cellId || cellType) && (
            <div className={styles['meta-row']}>
              {cellId && (
                <span>
                  cell: <span className={styles.mono}>{cellId}</span>
                </span>
              )}
              {cellType && (
                <span>
                  type: <span className={styles.mono}>{cellType}</span>
                </span>
              )}
            </div>
          )}
          {newSource && editMode !== 'delete' && (
            <pre className={toolText['output-pre']}>{newSource}</pre>
          )}
        </div>
      )}
    </ToolCard>
  );
};

export const NotebookEditTool = memo(NotebookEditToolInner);
