import { memo } from 'react';
import { FileSearch } from 'lucide-react';
import type { ToolAggregate } from '@/types/tools.types';
import { extractFilename } from '@/utils/format';
import { ToolCard } from '../common/ToolCard/ToolCard';
import { NumberedContent } from '../common/NumberedContent/NumberedContent';
import { OpenInEditorButton } from '../common/OpenInEditorButton/OpenInEditorButton';
import {
  type ShellLikeInput,
  type ShellLikeOutput,
  extractCommand,
  extractOutput,
  renderCommand,
} from './codexShellPayload';
import styles from './ReadTool.module.scss';

export const ReadTool = memo(function ReadTool({ tool }: { tool: ToolAggregate }) {
  const input = tool.input as ShellLikeInput | undefined;
  const result = tool.result as ShellLikeOutput | undefined;
  // Command-action reads carry parsed_cmd; image views send a bare {path}.
  const filePath = input?.parsed_cmd?.[0]?.path ?? input?.path ?? '';
  const fileLabel = filePath ? extractFilename(filePath) : 'file';
  const content = extractOutput(result);
  const command = extractCommand(input);

  return (
    <ToolCard
      icon={<FileSearch className={styles.icon} />}
      status={tool.status}
      title={(status) => {
        switch (status) {
          case 'completed':
            return `Read ${fileLabel}`;
          case 'failed':
            return `Failed to read ${fileLabel}`;
          default:
            return `Reading ${fileLabel}`;
        }
      }}
      loadingContent="Loading file content..."
      error={tool.error}
      actions={filePath ? <OpenInEditorButton filePath={filePath} /> : null}
    >
      {(filePath || command || content) && (
        <div className={styles.body}>
          {filePath && <div className={styles.path}>{filePath}</div>}
          {renderCommand(command)}
          {content && <NumberedContent content={content} />}
        </div>
      )}
    </ToolCard>
  );
});
