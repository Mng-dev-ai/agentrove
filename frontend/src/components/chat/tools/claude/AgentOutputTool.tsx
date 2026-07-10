import { memo } from 'react';
import { SquareTerminal } from 'lucide-react';
import type { ToolAggregate } from '@/types/tools.types';
import { formatResult } from '@/utils/format';
import { ToolCard } from '../common/ToolCard/ToolCard';
import toolIcon from './toolIcon.module.scss';
import styles from './AgentOutputTool.module.scss';

interface AgentOutputInput {
  task_id?: string;
  bash_id?: string;
  block?: boolean;
  timeout?: number;
}

function OutputToolInner({
  tool,
  idField,
  label,
}: {
  tool: ToolAggregate;
  idField: 'task_id' | 'bash_id';
  label: string;
}) {
  const input = tool.input as AgentOutputInput | undefined;
  const id = input?.[idField] ?? '';
  const truncatedId = id.length > 12 ? `${id.slice(0, 12)}\u2026` : id;
  const idSuffix = id ? `: ${truncatedId}` : '';

  const output = formatResult(tool.result);

  return (
    <ToolCard
      icon={<SquareTerminal className={toolIcon.icon} />}
      status={tool.status}
      title={(status) => {
        switch (status) {
          case 'completed':
            return `Got ${label} output${idSuffix}`;
          case 'failed':
            return `Failed to get ${label} output${idSuffix}`;
          default:
            return `Getting ${label} output${idSuffix}`;
        }
      }}
      loadingContent={`Waiting for ${label} output\u2026`}
      error={tool.error}
    >
      {output && (
        <div className={styles.output}>
          <pre className={styles.pre}>{output}</pre>
        </div>
      )}
    </ToolCard>
  );
}

export const AgentOutputTool = memo(function AgentOutputTool({ tool }: { tool: ToolAggregate }) {
  return <OutputToolInner tool={tool} idField="task_id" label="agent" />;
});

export const BashOutputTool = memo(function BashOutputTool({ tool }: { tool: ToolAggregate }) {
  return <OutputToolInner tool={tool} idField="bash_id" label="bash" />;
});
