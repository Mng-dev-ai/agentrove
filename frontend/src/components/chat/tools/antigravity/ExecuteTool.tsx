import { memo } from 'react';
import clsx from 'clsx';
import { Terminal } from 'lucide-react';
import type { ToolAggregate } from '@/types/tools.types';
import { ToolCard } from '../common/ToolCard/ToolCard';
import toolText from '../common/toolText.module.scss';
import type { AntigravityExecuteInput, AntigravityExecuteOutput } from './antigravityPayload';
import styles from './ExecuteTool.module.scss';

export const ExecuteTool = memo(function ExecuteTool({ tool }: { tool: ToolAggregate }) {
  const input = tool.input as AntigravityExecuteInput | undefined;
  const result = tool.result as AntigravityExecuteOutput | undefined;
  const command = input?.command_line ?? result?.commandLine ?? tool.title?.trim() ?? '';
  const workingDir = input?.working_dir ?? result?.workingDir ?? '';
  const output = result?.combinedOutput ?? result?.formatted_output ?? '';
  const exitCode = result?.exitCode ?? result?.exit_code;
  const failed = typeof exitCode === 'number' && exitCode !== 0;
  const displayStatus = tool.status === 'completed' && failed ? 'failed' : tool.status;
  const label = command || 'command';

  return (
    <ToolCard
      icon={<Terminal className={styles.icon} />}
      status={displayStatus}
      title={(status) => {
        switch (status) {
          case 'completed':
            return `Ran: ${label}`;
          case 'failed':
            return failed ? `Failed (exit ${exitCode}): ${label}` : `Failed: ${label}`;
          default:
            return `Running: ${label}`;
        }
      }}
      loadingContent="Running command..."
      error={tool.error}
    >
      {(command || workingDir || output || typeof exitCode === 'number') && (
        <div className={styles.body}>
          {command && (
            <pre className={styles.command}>
              <span className={styles.prompt}>$ </span>
              {command}
            </pre>
          )}
          {(workingDir || typeof exitCode === 'number') && (
            <div className={styles.meta}>
              {workingDir && <span className={styles.cwd}>{workingDir}</span>}
              {typeof exitCode === 'number' && (
                <span className={clsx(styles.badge, failed && styles['badge--failed'])}>
                  exit {exitCode}
                </span>
              )}
            </div>
          )}
          {output && (
            <pre className={clsx(toolText['output-pre'], failed && toolText['output-pre--error'])}>
              {output}
            </pre>
          )}
        </div>
      )}
    </ToolCard>
  );
});
