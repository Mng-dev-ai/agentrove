import { memo } from 'react';
import { Terminal } from 'lucide-react';
import type { ToolAggregate } from '@/types/tools.types';
import { ToolCard } from '../common/ToolCard/ToolCard';
import toolText from '../common/toolText.module.scss';
import toolIcon from './toolIcon.module.scss';
import type { GrokBashInput, GrokBashOutput } from './grokPayload';
import styles from './BashTool.module.scss';

const ICON = <Terminal className={toolIcon.icon} />;

export const BashTool = memo(function BashTool({ tool }: { tool: ToolAggregate }) {
  const input = tool.input as GrokBashInput | undefined;
  const result = tool.result as GrokBashOutput | undefined;

  const command = input?.command ?? '';
  const description = input?.description?.trim();
  // output_for_prompt starts with an "exit: N" line on completion — the exit
  // code already colors the card status, so strip it from the visible output.
  const output = (result?.output_for_prompt ?? '').replace(/^exit: -?\d+\n?/, '');

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
