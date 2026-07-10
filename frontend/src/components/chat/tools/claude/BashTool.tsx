import { memo } from 'react';
import { Terminal } from 'lucide-react';
import type { ToolAggregate } from '@/types/tools.types';
import { formatResult } from '@/utils/format';
import { ToolCard } from '../common/ToolCard/ToolCard';
import toolText from '../common/toolText.module.scss';
import toolIcon from './toolIcon.module.scss';
import styles from './BashTool.module.scss';

interface BashInput {
  command: string;
  description?: string;
  timeout?: number;
  run_in_background?: boolean;
}

const BashToolInner: React.FC<{ tool: ToolAggregate }> = ({ tool }) => {
  const input = tool.input as BashInput | undefined;
  const command = input?.command ?? '';
  const description = input?.description;

  const output = formatResult(tool.result);

  return (
    <ToolCard
      icon={<Terminal className={toolIcon.icon} />}
      status={tool.status}
      title={(status) => {
        if (description) {
          return status === 'failed' ? `Failed: ${description}` : description;
        }
        if (!command) return status === 'completed' ? 'Ran command' : 'Run command';
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
        <div className={styles.content}>
          {command && (
            <pre className={styles.command}>
              <span className={styles.prompt}>$ </span>
              {command}
            </pre>
          )}
          {output.length > 0 && <pre className={toolText['output-pre']}>{output}</pre>}
        </div>
      )}
    </ToolCard>
  );
};

export const BashTool = memo(BashToolInner);
