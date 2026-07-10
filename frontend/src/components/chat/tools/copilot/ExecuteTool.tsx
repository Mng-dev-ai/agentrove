import { memo } from 'react';
import { Terminal } from 'lucide-react';
import type { ToolAggregate } from '@/types/tools.types';
import { ToolCard } from '../common/ToolCard/ToolCard';
import toolText from '../common/toolText.module.scss';
import toolIcon from './toolIcon.module.scss';
import styles from './ExecuteTool.module.scss';
import type { CopilotExecuteInput, CopilotToolOutput } from './copilotPayload';

const ICON = <Terminal className={toolIcon.icon} />;

const ExecuteToolInner: React.FC<{ tool: ToolAggregate }> = ({ tool }) => {
  const input = tool.input as CopilotExecuteInput | undefined;
  const result = tool.result as CopilotToolOutput | undefined;

  const command = input?.command ?? '';
  const description = input?.description?.trim();
  const output = result?.content ?? '';

  return (
    <ToolCard
      icon={ICON}
      status={tool.status}
      title={(status) => {
        const label = description || command || 'command';
        switch (status) {
          case 'completed':
            return `Ran: ${label}`;
          case 'failed':
            return `Failed: ${label}`;
          default:
            return `Running: ${label}`;
        }
      }}
      loadingContent="Running command..."
      error={tool.error}
    >
      {(command || output) && (
        <div className={styles.content}>
          {command && (
            <pre className={styles.command}>
              <span className={styles.prompt}>$ </span>
              {command}
            </pre>
          )}
          {output && <pre className={toolText['output-pre']}>{output}</pre>}
        </div>
      )}
    </ToolCard>
  );
};

export const ExecuteTool = memo(ExecuteToolInner);
