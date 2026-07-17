import { GitBranch } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button/Button';
import { useChatQuery } from '@/hooks/queries/useChatQueries';
import { useSettingsForChatQuery } from '@/hooks/queries/useSettingsQueries';
import { useRunStreamAction } from '@/hooks/useRunStreamAction';
import styles from './StreamActionsBar.module.scss';

interface StreamActionsBarProps {
  chatId: string;
}

export function StreamActionsBar({ chatId }: StreamActionsBarProps) {
  const { data: chat } = useChatQuery(chatId);
  // Stream actions come from the instance that owns the chat (local or cloud VPS).
  const { data: settings } = useSettingsForChatQuery(chatId);
  const runAction = useRunStreamAction(chat);

  const enabledActions = (settings?.stream_actions ?? []).filter((action) => action.enabled);

  // Only top-level threads spawn sub-thread reviews (nesting is one level).
  if (!chat || chat.parent_chat_id || enabledActions.length === 0) {
    return null;
  }

  return (
    <div className={styles['stream-actions']}>
      <span className={styles['stream-actions-label']}>Run</span>
      {enabledActions.map((action) => (
        <Button
          key={action.label}
          type="button"
          variant="outline"
          size="sm"
          onClick={() => runAction(action)}
          className={styles['action-button']}
        >
          <GitBranch className={styles['action-icon']} />
          {action.label}
        </Button>
      ))}
    </div>
  );
}
