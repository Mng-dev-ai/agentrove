import { memo } from 'react';
import { XCircle } from 'lucide-react';
import type { ToolAggregate } from '@/types/tools.types';
import { ToolCard } from '../common/ToolCard/ToolCard';
import toolIcon from './toolIcon.module.scss';

interface KillShellInput {
  shell_id: string;
}

const KillShellToolInner: React.FC<{ tool: ToolAggregate }> = ({ tool }) => {
  const input = tool.input as KillShellInput | undefined;
  const shellId = input?.shell_id ?? '';
  const idSuffix = shellId ? `: ${shellId}` : '';

  return (
    <ToolCard
      icon={<XCircle className={toolIcon.icon} />}
      status={tool.status}
      title={(status) => {
        switch (status) {
          case 'completed':
            return `Killed shell${idSuffix}`;
          case 'failed':
            return `Failed to kill shell${idSuffix}`;
          default:
            return `Killing shell${idSuffix}`;
        }
      }}
      loadingContent="Terminating shell..."
      error={tool.error}
    />
  );
};

export const KillShellTool = memo(KillShellToolInner);
