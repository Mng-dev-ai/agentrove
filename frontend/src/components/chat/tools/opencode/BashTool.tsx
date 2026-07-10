import { memo } from 'react';
import { Terminal } from 'lucide-react';
import type { ToolAggregate } from '@/types/tools.types';
import { ToolCard } from '../common/ToolCard/ToolCard';
import toolText from '../common/toolText.module.scss';
import toolIcon from './toolIcon.module.scss';
import type { OpencodeBashInput, OpencodeOutput } from './opencodePayload';
import styles from './BashTool.module.scss';

const ICON = <Terminal className={toolIcon.icon} />;

export const BashTool = memo(function BashTool({ tool }: { tool: ToolAggregate }) {
  const input = tool.input as OpencodeBashInput | undefined;
  const result = tool.result as OpencodeOutput | undefined;

  const command = input?.command ?? '';
  const description = input?.description?.trim();
  const output = result?.output ?? '';

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
        <div className={styles.body}>
          {command && (
            <pre className={styles['command-pre']}>
              <span className={styles['command-prompt']}>$ </span>
              {command}
            </pre>
          )}
          {output && <pre className={toolText['output-pre']}>{output}</pre>}
        </div>
      )}
    </ToolCard>
  );
});
