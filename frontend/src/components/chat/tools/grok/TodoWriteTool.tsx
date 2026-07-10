import { memo } from 'react';
import { ListTodo } from 'lucide-react';
import type { ToolAggregate } from '@/types/tools.types';
import { ToolCard } from '../common/ToolCard/ToolCard';
import toolIcon from './toolIcon.module.scss';
import type { GrokTodoWriteInput } from './grokPayload';

const ICON = <ListTodo className={toolIcon.icon} />;

export const TodoWriteTool = memo(function TodoWriteTool({ tool }: { tool: ToolAggregate }) {
  // Grok mirrors every todo_write into an ACP plan update that renders the
  // full checklist, and merge updates carry partial entries (content: null) —
  // so this card stays a compact marker instead of repeating the list.
  const input = tool.input as GrokTodoWriteInput | undefined;
  const total = input?.todos?.length ?? 0;
  const suffix = total > 0 ? ` (${total} item${total !== 1 ? 's' : ''})` : '';

  return (
    <ToolCard
      icon={ICON}
      status={tool.status}
      title={(status) => {
        switch (status) {
          case 'completed':
            return `Updated plan${suffix}`;
          case 'failed':
            return 'Failed to update plan';
          default:
            return 'Updating plan...';
        }
      }}
      loadingContent="Updating plan..."
      error={tool.error}
    />
  );
});
