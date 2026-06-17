import { GitBranch } from 'lucide-react';
import { ListManagementTab } from '@/components/ui/ListManagementTab';
import { Switch } from '@/components/ui/primitives/Switch';
import type { StreamAction } from '@/types/user.types';

interface StreamActionsSettingsTabProps {
  actions: StreamAction[] | null;
  onAdd: () => void;
  onEdit: (index: number) => void;
  onDelete: (index: number) => void | Promise<void>;
  onToggle: (index: number, enabled: boolean) => void | Promise<void>;
}

export const StreamActionsSettingsTab: React.FC<StreamActionsSettingsTabProps> = ({
  actions,
  onAdd,
  onEdit,
  onDelete,
  onToggle,
}) => {
  return (
    <ListManagementTab<StreamAction>
      title="Stream actions"
      description="Buttons shown when a thread finishes streaming. Each runs its command on the selected model in a new sub-thread."
      items={actions}
      emptyIcon={GitBranch}
      emptyText="No stream actions configured yet"
      emptyButtonText="Add your first action"
      addButtonText="Add action"
      deleteConfirmTitle="Delete action"
      deleteConfirmMessage={(action) =>
        `Are you sure you want to delete "${action.label}"? This action cannot be undone.`
      }
      getItemKey={(action) => action.label}
      onAdd={onAdd}
      onEdit={onEdit}
      onDelete={onDelete}
      renderItem={(action) => (
        <>
          <h3 className="mb-2 truncate text-xs font-medium text-text-primary dark:text-text-dark-primary">
            {action.label}
          </h3>
          <div className="flex items-center gap-2 font-mono text-2xs text-text-secondary dark:text-text-dark-secondary">
            <span className="rounded-md border border-border/50 px-1.5 py-0.5 dark:border-border-dark/50">
              {action.model_id}
            </span>
            <span className="truncate text-text-quaternary dark:text-text-dark-quaternary">
              {action.command}
            </span>
          </div>
        </>
      )}
      renderItemActions={(action, index) => (
        <Switch
          size="sm"
          checked={action.enabled}
          onCheckedChange={(enabled) => onToggle(index, enabled)}
          aria-label={action.enabled ? 'Disable action' : 'Enable action'}
        />
      )}
      logContext="StreamActionsSettingsTab"
    />
  );
};
