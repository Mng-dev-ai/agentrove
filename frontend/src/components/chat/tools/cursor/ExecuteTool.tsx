import { memo } from 'react';
import clsx from 'clsx';
import { Terminal } from 'lucide-react';
import type { ToolAggregate } from '@/types/tools.types';
import { ToolCard } from '../common/ToolCard/ToolCard';
import toolText from '../common/toolText.module.scss';
import type { CursorExecuteOutput } from './cursorPayload';
import styles from './ExecuteTool.module.scss';

const ICON = <Terminal className={styles.icon} />;

const ExecuteToolInner: React.FC<{ tool: ToolAggregate }> = ({ tool }) => {
  const result = tool.result as CursorExecuteOutput | undefined;

  // Cursor leaves rawInput empty on streamed tool_call events, so the title
  // ("Terminal") is all we have for the header. Fall back to a generic label.
  const title = tool.title?.trim() || 'command';
  const stdout = result?.stdout ?? '';
  const stderr = result?.stderr ?? '';
  const exitCode = result?.exitCode;
  const failed = typeof exitCode === 'number' && exitCode !== 0;

  return (
    <ToolCard
      icon={ICON}
      status={tool.status}
      title={(status) => {
        switch (status) {
          case 'completed':
            return failed ? `Failed (exit ${exitCode}): ${title}` : `Ran: ${title}`;
          case 'failed':
            return `Failed: ${title}`;
          default:
            return `Running: ${title}`;
        }
      }}
      loadingContent="Running command..."
      error={tool.error}
    >
      {(stdout || stderr) && (
        <div className={styles.body}>
          {stdout && <pre className={toolText['output-pre']}>{stdout}</pre>}
          {stderr && (
            <pre className={clsx(toolText['output-pre'], toolText['output-pre--error'])}>
              {stderr}
            </pre>
          )}
        </div>
      )}
    </ToolCard>
  );
};

export const ExecuteTool = memo(ExecuteToolInner);
