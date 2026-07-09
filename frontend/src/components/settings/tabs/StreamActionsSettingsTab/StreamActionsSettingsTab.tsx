import { Suspense, useCallback } from 'react';
import { GitBranch } from 'lucide-react';
import { ListManagementTab } from '@/components/ui/ListManagementTab/ListManagementTab';
import { Switch } from '@/components/ui/primitives/Switch/Switch';
import { useSettingsContext } from '@/hooks/useSettingsContext';
import { useCrudForm } from '@/hooks/useCrudForm';
import { createDefaultStreamActionForm, validateStreamActionForm } from '@/utils/settings';
import { lazyNamed } from '@/utils/lazyNamed';
import type { StreamAction } from '@/types/user.types';
import styles from './StreamActionsSettingsTab.module.scss';

const StreamActionEditDialog = lazyNamed(
  () => import('@/components/settings/dialogs/StreamActionEditDialog/StreamActionEditDialog'),
  'StreamActionEditDialog',
);

export const StreamActionsSettingsTab: React.FC = () => {
  const { localSettings, persistSettings } = useSettingsContext();

  const actionCrud = useCrudForm(localSettings, persistSettings, {
    createDefault: createDefaultStreamActionForm,
    validateForm: (form, editingIndex) =>
      validateStreamActionForm(form, editingIndex, localSettings.stream_actions ?? []),
    getArrayKey: 'stream_actions',
    itemName: 'action',
  });

  const handleToggle = useCallback(
    (index: number, enabled: boolean) =>
      persistSettings(
        (prev) => {
          const next = [...(prev.stream_actions ?? [])];
          const target = next[index];
          if (!target) return prev;
          next[index] = { ...target, enabled };
          return { ...prev, stream_actions: next };
        },
        { errorMessage: 'Failed to update action' },
      ),
    [persistSettings],
  );

  return (
    <>
      <ListManagementTab<StreamAction>
        title="Stream actions"
        description="Buttons shown when a thread finishes streaming. Each runs its command on the selected model in a new sub-thread."
        items={localSettings.stream_actions ?? []}
        emptyIcon={GitBranch}
        emptyText="No stream actions configured yet"
        emptyButtonText="Add your first action"
        addButtonText="Add action"
        deleteConfirmTitle="Delete action"
        deleteConfirmMessage={(action) =>
          `Are you sure you want to delete "${action.label}"? This action cannot be undone.`
        }
        getItemKey={(action) => action.label}
        onAdd={actionCrud.handleAdd}
        onEdit={actionCrud.handleEdit}
        onDelete={actionCrud.handleDelete}
        renderItem={(action) => (
          <>
            <h3 className={styles['item-title']}>{action.label}</h3>
            <div className={styles['item-meta']}>
              <span className={styles.chip}>{action.model_id}</span>
              <span className={styles['item-command']}>{action.command}</span>
            </div>
          </>
        )}
        renderItemActions={(action, index) => (
          <Switch
            size="sm"
            className={styles.toggle}
            checked={action.enabled}
            onCheckedChange={(enabled) => handleToggle(index, enabled)}
            aria-label={action.enabled ? 'Disable action' : 'Enable action'}
          />
        )}
        logContext="StreamActionsSettingsTab"
      />
      {actionCrud.isDialogOpen && (
        <Suspense fallback={null}>
          <StreamActionEditDialog
            isOpen={actionCrud.isDialogOpen}
            isEditing={actionCrud.editingIndex !== null}
            action={actionCrud.form}
            personas={localSettings.personas ?? []}
            error={actionCrud.formError}
            onClose={actionCrud.handleDialogClose}
            onSubmit={actionCrud.handleSave}
            onActionChange={actionCrud.handleFormChange}
          />
        </Suspense>
      )}
    </>
  );
};
