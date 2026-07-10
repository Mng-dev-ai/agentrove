import clsx from 'clsx';
import { ListTodo, CheckCircle2, Circle, Clock } from 'lucide-react';
import type { ToolAggregate } from '@/types/tools.types';
import { ToolCard } from '../common/ToolCard/ToolCard';
import toolIcon from './toolIcon.module.scss';
import styles from './TodoWrite.module.scss';

interface Todo {
  content: string;
  activeForm: string;
  status: 'pending' | 'in_progress' | 'completed';
}

interface TodoWriteProps {
  tool: ToolAggregate;
}

export function TodoWrite({ tool }: TodoWriteProps) {
  const todos = Array.isArray(tool.input?.todos) ? tool.input.todos : [];
  const todoCount = todos.length;
  const completedCount = todos.filter((todo) => todo.status === 'completed').length;
  const inProgressCount = todos.filter((todo) => todo.status === 'in_progress').length;
  const pendingCount = todos.filter((todo) => todo.status === 'pending').length;

  const summaryMeta =
    completedCount > 0 || inProgressCount > 0 || pendingCount > 0 ? (
      <>
        {completedCount > 0 && (
          <span className={styles['summary-done']}>{completedCount} done</span>
        )}
        {inProgressCount > 0 && (
          <span className={styles['summary-active']}>{inProgressCount} active</span>
        )}
        {pendingCount > 0 && (
          <span className={styles['summary-pending']}>{pendingCount} pending</span>
        )}
      </>
    ) : null;

  const toolStatus = tool.status;
  const errorMessage = tool.error;

  const getTodoStatusIcon = (status: Todo['status']) => {
    switch (status) {
      case 'completed':
        return (
          <CheckCircle2 className={clsx(styles['status-icon'], styles['status-icon--completed'])} />
        );
      case 'in_progress':
        return (
          <Clock className={clsx(styles['status-icon'], styles['status-icon--in-progress'])} />
        );
      case 'pending':
      default:
        return <Circle className={clsx(styles['status-icon'], styles['status-icon--pending'])} />;
    }
  };

  return (
    <ToolCard
      icon={<ListTodo className={toolIcon.icon} />}
      status={toolStatus}
      title={(status) => {
        switch (status) {
          case 'completed':
            return `Updated todos (${todoCount} item${todoCount !== 1 ? 's' : ''})`;
          case 'failed':
            return 'Failed to update todos';
          default:
            return 'Updating todos';
        }
      }}
      loadingContent="Updating todo list..."
      error={errorMessage}
    >
      {todoCount > 0 && (
        <div>
          <div className={styles.summary}>{summaryMeta}</div>
          <div className={styles.list}>
            {todos.map((todo, index) => (
              <div key={`${index}-${todo.content}`} className={styles.row}>
                <div className={styles['status-icon-wrap']}>{getTodoStatusIcon(todo.status)}</div>
                <div className={styles.content}>
                  <p
                    className={clsx(
                      styles.label,
                      todo.status === 'completed' && styles['label--completed'],
                    )}
                  >
                    {todo.status === 'in_progress' ? todo.activeForm : todo.content}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </ToolCard>
  );
}
