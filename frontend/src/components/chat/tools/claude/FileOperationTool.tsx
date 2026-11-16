import { memo, useMemo } from 'react';
import clsx from 'clsx';
import { diffLines } from 'diff';
import { FileSearch, FileEdit as FileEditIcon, FilePlus } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ToolAggregate } from '@/types/tools.types';
import type { ToolComponent } from '@/types/ui.types';
import type { MessageAttachment } from '@/types/chat.types';
import { AttachmentViewer } from '@/components/ui/attachment-viewer/AttachmentViewer';
import { ToolCard } from '../common/ToolCard/ToolCard';
import { NumberedContent } from '../common/NumberedContent/NumberedContent';
import { OpenInEditorButton } from '../common/OpenInEditorButton/OpenInEditorButton';
import toolIcon from './toolIcon.module.scss';
import styles from './FileOperationTool.module.scss';

// Claude's Read output embeds real line numbers before each line. The
// separator has shifted between agent versions: older builds used "→"
// (U+2192), newer builds use a tab. Handle both so we use the real line
// numbers instead of the array index.
const CLAUDE_READ_LINE_PREFIX = /^\s*(\d+)(?:→|\t)/;

interface FileOperationToolProps {
  tool: ToolAggregate;
  variant: 'read' | 'edit' | 'write';
}

interface TitleConfig {
  inProgress: string;
  completed: string;
  failed: string;
}

interface OperationConfig {
  icon: LucideIcon;
  titles: TitleConfig;
}

const OPERATION_CONFIGS: Record<'read' | 'edit' | 'write', OperationConfig> = {
  read: {
    icon: FileSearch,
    titles: { inProgress: 'Reading', completed: 'Read', failed: 'Failed to read' },
  },
  edit: {
    icon: FileEditIcon,
    titles: { inProgress: 'Editing', completed: 'Edited', failed: 'Failed to edit' },
  },
  write: {
    icon: FilePlus,
    titles: { inProgress: 'Writing', completed: 'Wrote', failed: 'Failed to write' },
  },
};

const normalizeContent = (result: unknown): string => {
  if (typeof result === 'string') return result;
  if (Array.isArray(result)) return result.join('\n');
  if (result === null || result === undefined) return '';
  return JSON.stringify(result, null, 2);
};

interface ImageBlock {
  type: 'image';
  source: { type: 'base64'; media_type: string; data: string };
}

const isImageBlock = (block: unknown): block is ImageBlock =>
  typeof block === 'object' && block !== null && (block as ImageBlock).type === 'image';

const toImageAttachments = (tool: ToolAggregate, filePath: string): MessageAttachment[] => {
  if (!Array.isArray(tool.result)) return [];
  return tool.result.filter(isImageBlock).map((block, idx) => ({
    id: `${tool.id}-${idx}`,
    file_url: `data:${block.source.media_type};base64,${block.source.data}`,
    file_type: 'image',
    filename: filePath.split('/').pop() || 'image',
    message_id: '',
    created_at: '',
  }));
};

interface DiffLine {
  type: 'added' | 'removed' | 'context';
  content: string;
}

const computeDiffLines = (oldStr: string, newStr: string): DiffLine[] => {
  const changes = diffLines(oldStr, newStr);
  const result: DiffLine[] = [];

  for (const change of changes) {
    const lines = change.value.endsWith('\n')
      ? change.value.slice(0, -1).split('\n')
      : change.value.split('\n');

    for (const line of lines) {
      if (change.removed) {
        result.push({ type: 'removed', content: line });
      } else if (change.added) {
        result.push({ type: 'added', content: line });
      } else {
        result.push({ type: 'context', content: line });
      }
    }
  }

  return result;
};

function InlineDiff({ oldContent, newContent }: { oldContent: string; newContent: string }) {
  const lines = useMemo(() => computeDiffLines(oldContent, newContent), [oldContent, newContent]);

  if (lines.length === 0) {
    return <p className={styles.empty}>No changes detected</p>;
  }

  return (
    <div className={styles.diff}>
      {lines.map((line, idx) => (
        <div key={idx} className={styles.line}>
          <span
            className={clsx(
              styles.gutter,
              line.type === 'removed' && styles['gutter--removed'],
              line.type === 'added' && styles['gutter--added'],
            )}
          >
            {line.type === 'removed' ? '−' : line.type === 'added' ? '+' : ' '}
          </span>
          <span
            className={clsx(
              styles.content,
              line.type === 'removed' && styles['content--removed'],
              line.type === 'added' && styles['content--added'],
            )}
          >
            {line.content || '\u00A0'}
          </span>
        </div>
      ))}
    </div>
  );
}

const FileOperationTool = memo(function FileOperationTool({
  tool,
  variant,
}: FileOperationToolProps) {
  const config = OPERATION_CONFIGS[variant];
  const Icon = config.icon;
  const filePath = (tool.input?.file_path as string | undefined) ?? '';

  if (variant === 'read' && tool.status === 'completed') {
    const images = toImageAttachments(tool, filePath);
    if (images.length > 0) return <AttachmentViewer attachments={images} size="large" />;
  }

  const renderContent = () => {
    if (variant === 'read') {
      const content = normalizeContent(tool.result);
      if (!content || tool.status !== 'completed') return null;
      return <NumberedContent content={content} prefixPattern={CLAUDE_READ_LINE_PREFIX} />;
    }

    if (variant === 'edit') {
      const oldString = typeof tool.input?.old_string === 'string' ? tool.input.old_string : '';
      const newString = typeof tool.input?.new_string === 'string' ? tool.input.new_string : '';
      if (!oldString && !newString) return null;

      return <InlineDiff oldContent={oldString} newContent={newString} />;
    }

    const content = typeof tool.input?.content === 'string' ? tool.input.content : '';
    if (!content) return null;
    return <NumberedContent content={content} />;
  };

  const hasContent =
    (variant === 'read' && tool.result) ||
    (variant === 'edit' &&
      (typeof tool.input?.old_string === 'string' || typeof tool.input?.new_string === 'string')) ||
    (variant === 'write' && typeof tool.input?.content === 'string' && tool.input.content);

  return (
    <ToolCard
      icon={<Icon className={toolIcon.icon} />}
      status={tool.status}
      title={(status) => {
        switch (status) {
          case 'completed':
            return `${config.titles.completed} ${filePath}`;
          case 'failed':
            return `${config.titles.failed} ${filePath}`;
          default:
            return `${config.titles.inProgress} ${filePath}`;
        }
      }}
      error={tool.error}
      actions={filePath ? <OpenInEditorButton filePath={filePath} /> : null}
    >
      {hasContent ? renderContent() : null}
    </ToolCard>
  );
});

export const WriteTool: ToolComponent = ({ tool }) => (
  <FileOperationTool tool={tool} variant="write" />
);

export const ReadTool: ToolComponent = ({ tool }) => (
  <FileOperationTool tool={tool} variant="read" />
);

export const EditTool: ToolComponent = ({ tool }) => (
  <FileOperationTool tool={tool} variant="edit" />
);
