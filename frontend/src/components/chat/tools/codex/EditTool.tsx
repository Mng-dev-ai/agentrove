import { memo, useMemo } from 'react';
import clsx from 'clsx';
import { structuredPatch } from 'diff';
import { FileEdit, FilePlus } from 'lucide-react';
import type { ToolAggregate } from '@/types/tools.types';
import { extractFilename } from '@/utils/format';
import { ToolCard } from '../common/ToolCard/ToolCard';
import { OpenInEditorButton } from '../common/OpenInEditorButton/OpenInEditorButton';
import styles from './EditTool.module.scss';

interface FileChange {
  type: 'add' | 'update' | 'delete';
  content?: string;
  unified_diff?: string;
  move_path?: string | null;
}

interface DiffBlock {
  path?: string | null;
  oldText?: string | null;
  newText?: string | null;
}

interface EditInput {
  changes?: Record<string, FileChange>;
}

interface EditOutput {
  success?: boolean;
  stdout?: string;
  changes?: Record<string, FileChange>;
  diffs?: DiffBlock[];
}

// codex-acp sends ACP diff blocks carrying full old/new file contents, so
// compute hunked unified diffs to render only the changed regions.
const toUnifiedDiff = (oldText: string, newText: string): string => {
  const patch = structuredPatch('', '', oldText, newText);
  return patch.hunks
    .map((h) =>
      [`@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`, ...h.lines].join('\n'),
    )
    .join('\n');
};

const diffBlockToFileChange = (block: DiffBlock): FileChange => {
  // ACP diff semantics: empty oldText = create, empty newText = delete.
  if (!block.oldText) {
    return { type: 'add', content: block.newText ?? '' };
  }
  if (!block.newText) {
    return { type: 'delete', unified_diff: toUnifiedDiff(block.oldText, '') };
  }
  return { type: 'update', unified_diff: toUnifiedDiff(block.oldText, block.newText) };
};

function DiffLine({ line }: { line: string }) {
  const isAdded = line.startsWith('+') && !line.startsWith('+++');
  const isRemoved = line.startsWith('-') && !line.startsWith('---');
  const isHeader = line.startsWith('@@');

  if (isHeader) {
    return <div className={styles['diff-header']}>{line}</div>;
  }

  return (
    <div className={styles.row}>
      <span
        className={clsx(
          styles['diff-gutter'],
          isRemoved && styles['diff-gutter--removed'],
          isAdded && styles['diff-gutter--added'],
        )}
      >
        {isRemoved ? '−' : isAdded ? '+' : ' '}
      </span>
      <span
        className={clsx(
          styles['diff-content'],
          isRemoved && styles['diff-content--removed'],
          isAdded && styles['diff-content--added'],
        )}
      >
        {line.slice(1) || '\u00A0'}
      </span>
    </div>
  );
}

function FileContent({ change }: { change: FileChange }) {
  if (change.unified_diff) {
    const lines = change.unified_diff.split('\n').filter((l) => l.length > 0);
    return (
      <div>
        {lines.map((line, idx) => (
          <DiffLine key={idx} line={line} />
        ))}
      </div>
    );
  }

  if (change.content) {
    return (
      <div>
        {change.content.split('\n').map((line, idx) => (
          <div key={idx} className={styles.row}>
            <span className={styles['numbered-gutter']}>{idx + 1}</span>
            <span className={styles['numbered-text']}>{line || '\u00A0'}</span>
          </div>
        ))}
      </div>
    );
  }

  return null;
}

export const EditTool = memo(function EditTool({ tool }: { tool: ToolAggregate }) {
  const input = tool.input as EditInput | undefined;
  const result = tool.result as EditOutput | undefined;

  const changedFiles = useMemo<[string, FileChange][]>(() => {
    const changes = input?.changes ?? result?.changes;
    if (changes) return Object.entries(changes);
    return (result?.diffs ?? []).map((block): [string, FileChange] => [
      block.path ?? '',
      diffBlockToFileChange(block),
    ]);
  }, [input, result]);

  const firstFilePath = changedFiles[0]?.[0] ?? '';
  const firstFileName = firstFilePath ? extractFilename(firstFilePath) : '';
  const isNewFile = changedFiles[0]?.[1]?.type === 'add';
  const fileCount = changedFiles.length;

  const Icon = isNewFile ? FilePlus : FileEdit;

  const target = fileCount > 1 ? `${fileCount} files` : firstFileName;

  return (
    <ToolCard
      icon={<Icon className={styles.icon} />}
      status={tool.status}
      title={(status) => {
        const label = isNewFile ? 'Created' : 'Edited';
        const verb = isNewFile ? 'Creating' : 'Editing';
        switch (status) {
          case 'completed':
            return `${label} ${target}`;
          case 'failed':
            return `Failed to edit ${target}`;
          default:
            return `${verb} ${target}`;
        }
      }}
      loadingContent={isNewFile ? 'Creating file...' : 'Applying changes...'}
      error={tool.error}
      actions={firstFilePath ? <OpenInEditorButton filePath={firstFilePath} /> : null}
    >
      {changedFiles.length > 0 && (
        <div className={styles.body}>
          {changedFiles.map(([filePath, change]) => (
            <div key={filePath} className={styles['file-block']}>
              {fileCount > 1 && (
                <div className={styles['file-block-header']}>
                  <span
                    className={clsx(
                      styles['file-badge'],
                      change.type === 'add' && styles['file-badge--add'],
                      change.type === 'delete' && styles['file-badge--delete'],
                    )}
                  >
                    {change.type === 'add' ? 'A' : change.type === 'delete' ? 'D' : 'M'}
                  </span>
                  <span className={styles['file-name']}>{extractFilename(filePath)}</span>
                </div>
              )}
              <FileContent change={change} />
            </div>
          ))}
        </div>
      )}
    </ToolCard>
  );
});
