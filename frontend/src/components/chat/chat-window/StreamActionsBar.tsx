import { GitBranch } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button/Button';
import { useChatQuery } from '@/hooks/queries/useChatQueries';
import { useSettingsQuery } from '@/hooks/queries/useSettingsQueries';
import { useRunStreamAction } from '@/hooks/useRunStreamAction';

interface StreamActionsBarProps {
  chatId: string;
}

export function StreamActionsBar({ chatId }: StreamActionsBarProps) {
  const { data: chat } = useChatQuery(chatId);
  const { data: settings } = useSettingsQuery();
  const runAction = useRunStreamAction(chat);

  const enabledActions = (settings?.stream_actions ?? []).filter((action) => action.enabled);

  // Only top-level threads spawn sub-thread reviews (nesting is one level).
  if (!chat || chat.parent_chat_id || enabledActions.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-2 px-4 pb-2 sm:px-6">
      <span className="text-2xs font-medium uppercase tracking-wider text-text-quaternary dark:text-text-dark-quaternary">
        Run
      </span>
      {enabledActions.map((action) => (
        <Button
          key={action.label}
          type="button"
          variant="outline"
          size="sm"
          onClick={() => runAction(action)}
          className="gap-1.5"
        >
          <GitBranch className="h-3.5 w-3.5" />
          {action.label}
        </Button>
      ))}
    </div>
  );
}
