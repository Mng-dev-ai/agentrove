import { memo } from 'react';
import clsx from 'clsx';
import { ListTodo, CheckCircle2, Circle, Clock, XCircle } from 'lucide-react';
import type { ToolAggregate } from '@/types/tools.types';
import { ToolCard } from '../common/ToolCard/ToolCard';
import toolIcon from './toolIcon.module.scss';
import type { OpencodeTodoInfo, OpencodeTodoWriteInput } from './opencodePayload';
import styles from './TodoWriteTool.module.scss';

const ICON = <ListTodo className={toolIcon.icon} />;

const STATUS_ICON: Record<NonNullable<OpencodeTodoInfo['status']>, React.ReactNode> = {
  completed: (
    <CheckCircle2 className={clsx(styles['status-icon'], styles['status-icon--completed'])} />
  ),
  in_progress: (
    <Clock className={clsx(styles['status-icon'], styles['status-icon--in-progress'])} />
  ),
  pending: <Circle className={clsx(styles['status-icon'], styles['status-icon--pending'])} />,
  cancelled: <XCircle className={clsx(styles['status-icon'], styles['status-icon--cancelled'])} />,
};

const TodoWriteToolInner: React.FC<{ tool: ToolAggregate }> = ({ tool }) => {
  const input = tool.input as OpencodeTodoWriteInput | undefined;
  const todos = input?.todos ?? [];

  const counts = todos.reduce(
    (acc, t) => {
      if (t.status === 'completed') acc.completed++;
      else if (t.status === 'in_progress') acc.inProgress++;
      else if (t.status === 'pending') acc.pending++;
      return acc;
    },
    { completed: 0, inProgress: 0, pending: 0 },
  );
  const total = todos.length;

  return (
    <ToolCard
      icon={ICON}
      status={tool.status}
      title={(status) => {
        switch (status) {
          case 'completed':
            return `Updated todos (${total} item${total !== 1 ? 's' : ''})`;
          case 'failed':
            return 'Failed to update todos';
          default:
            return 'Updating todos';
        }
      }}
      loadingContent="Updating todo list..."
      error={tool.error}
    >
      {total > 0 && (
        <div>
          <div className={styles.summary}>
            {counts.completed > 0 && (
              <span className={styles['summary-done']}>{counts.completed} done</span>
            )}
            {counts.inProgress > 0 && (
              <span className={styles['summary-active']}>{counts.inProgress} active</span>
            )}
            {counts.pending > 0 && (
              <span className={styles['summary-pending']}>{counts.pending} pending</span>
            )}
          </div>
          <div className={styles.list}>
            {todos.map((todo, idx) => {
              const status = todo.status ?? 'pending';
              return (
                <div key={todo.id ?? `${idx}-${todo.content}`} className={styles.row}>
                  <div className={styles['status-icon-wrap']}>{STATUS_ICON[status]}</div>
                  <div className={styles.content}>
                    <p
                      className={clsx(
                        styles.label,
                        (status === 'completed' || status === 'cancelled') && styles['label--done'],
                      )}
                    >
                      {todo.content}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </ToolCard>
  );
};

export const TodoWriteTool = memo(TodoWriteToolInner);
