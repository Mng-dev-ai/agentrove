import { memo } from 'react';
import { FileSearch } from 'lucide-react';
import type { ToolAggregate } from '@/types/tools.types';
import { ToolCard } from '../common/ToolCard/ToolCard';
import { NumberedContent } from '../common/NumberedContent/NumberedContent';
import type { CursorReadOutput } from './cursorPayload';
import styles from './ReadTool.module.scss';

const ICON = <FileSearch className={styles.icon} />;

const ReadToolInner: React.FC<{ tool: ToolAggregate }> = ({ tool }) => {
  const result = tool.result as CursorReadOutput | undefined;
  // Cursor omits the file path from rawInput on streamed events, so the title
  // ("Read File") is all we can show for the header — the path isn't available.
  const title = tool.title?.trim() || 'file';
  const content = result?.content ?? '';

  return (
    <ToolCard
      icon={ICON}
      status={tool.status}
      title={(status) => {
        switch (status) {
          case 'completed':
            return `${title}`;
          case 'failed':
            return `Failed: ${title}`;
          default:
            return `${title}...`;
        }
      }}
      loadingContent="Loading file content..."
      error={tool.error}
    >
      {content && <NumberedContent content={content} />}
    </ToolCard>
  );
};

export const ReadTool = memo(ReadToolInner);
