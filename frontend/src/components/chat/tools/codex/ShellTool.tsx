import { memo } from 'react';
import { Terminal, FolderSearch, FileSearch } from 'lucide-react';
import type { ToolAggregate } from '@/types/tools.types';
import { ToolCard } from '../common/ToolCard/ToolCard';
import {
  ParsedCmdType,
  type ShellLikeInput,
  type ShellLikeOutput,
  extractCommand,
  extractOutput,
  renderCommand,
  renderOutput,
} from './codexShellPayload';
import styles from './ShellTool.module.scss';

const ICON_CLASS = styles.icon;

const ICON_BY_TYPE: Record<ParsedCmdType, React.ReactNode> = {
  list_files: <FolderSearch className={ICON_CLASS} />,
  search: <FileSearch className={ICON_CLASS} />,
  read: <FileSearch className={ICON_CLASS} />,
  unknown: <Terminal className={ICON_CLASS} />,
};

export const ShellTool = memo(function ShellTool({ tool }: { tool: ToolAggregate }) {
  const input = tool.input as ShellLikeInput | undefined;
  const result = tool.result as ShellLikeOutput | undefined;

  const command = extractCommand(input);
  const toolType = input?.parsed_cmd?.[0]?.type ?? 'unknown';
  const title = tool.title.trim();
  const toolKindLabel = toolType === 'unknown' ? 'Execute' : `Execute (${toolType})`;

  const output = extractOutput(result);

  return (
    <ToolCard
      icon={ICON_BY_TYPE[toolType]}
      status={tool.status}
      title={(status) => {
        if (title) {
          switch (status) {
            case 'completed':
              return `${toolKindLabel}: ${title}`;
            case 'failed':
              return `Failed ${toolKindLabel.toLowerCase()}: ${title}`;
            default:
              return `${toolKindLabel}: ${title}`;
          }
        }
        if (!command) return status === 'completed' ? 'Ran command' : 'Running command';
        switch (status) {
          case 'completed':
            return `Ran: ${command}`;
          case 'failed':
            return `Failed: ${command}`;
          default:
            return `Running: ${command}`;
        }
      }}
      loadingContent="Running command..."
      error={tool.error}
    >
      {(command || output) && (
        <div className={styles.body}>
          {renderCommand(command)}
          {renderOutput(output)}
        </div>
      )}
    </ToolCard>
  );
});
