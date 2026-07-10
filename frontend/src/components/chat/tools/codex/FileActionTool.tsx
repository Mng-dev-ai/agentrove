import { memo } from 'react';
import { FileX, FileOutput } from 'lucide-react';
import type { ToolAggregate } from '@/types/tools.types';
import { extractFilename } from '@/utils/format';
import { ToolCard } from '../common/ToolCard/ToolCard';
import { OpenInEditorButton } from '../common/OpenInEditorButton/OpenInEditorButton';
import styles from './FileActionTool.module.scss';

const ICON_CLASS = styles.icon;

interface DeleteInput {
  file_path?: string;
}

interface MoveInput {
  source?: string;
  destination?: string;
}

const DeleteToolInner: React.FC<{ tool: ToolAggregate }> = ({ tool }) => {
  const input = tool.input as DeleteInput | undefined;
  const filePath = input?.file_path ?? '';
  const fileName = filePath ? extractFilename(filePath) : '';

  return (
    <ToolCard
      icon={<FileX className={ICON_CLASS} />}
      status={tool.status}
      title={(status) => {
        switch (status) {
          case 'completed':
            return `Deleted ${fileName || 'file'}`;
          case 'failed':
            return `Failed to delete ${fileName || 'file'}`;
          default:
            return `Deleting ${fileName || 'file'}`;
        }
      }}
      loadingContent="Deleting file..."
      error={tool.error}
    >
      {filePath && <div className={styles.path}>{filePath}</div>}
    </ToolCard>
  );
};

const MoveToolInner: React.FC<{ tool: ToolAggregate }> = ({ tool }) => {
  const input = tool.input as MoveInput | undefined;
  const source = input?.source ?? '';
  const destination = input?.destination ?? '';
  const srcName = source ? extractFilename(source) : '';
  const dstName = destination ? extractFilename(destination) : '';

  return (
    <ToolCard
      icon={<FileOutput className={ICON_CLASS} />}
      status={tool.status}
      title={(status) => {
        const label = srcName && dstName ? `${srcName} → ${dstName}` : srcName || 'file';
        switch (status) {
          case 'completed':
            return `Moved ${label}`;
          case 'failed':
            return `Failed to move ${label}`;
          default:
            return `Moving ${label}`;
        }
      }}
      loadingContent="Moving file..."
      error={tool.error}
      actions={destination ? <OpenInEditorButton filePath={destination} /> : null}
    >
      {(source || destination) && (
        <div className={styles.paths}>
          {source && <div className={styles.path}>{source}</div>}
          {destination && <div className={styles.path}>{destination}</div>}
        </div>
      )}
    </ToolCard>
  );
};

export const DeleteTool = memo(DeleteToolInner);
export const MoveTool = memo(MoveToolInner);
