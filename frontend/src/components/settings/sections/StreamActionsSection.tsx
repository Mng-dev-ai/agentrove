import { Suspense, useCallback } from 'react';
import { useSettingsContext } from '@/hooks/useSettingsContext';
import { useCrudForm } from '@/hooks/useCrudForm';
import { createDefaultStreamActionForm, validateStreamActionForm } from '@/utils/settings';
import { lazyNamed } from '@/utils/lazyNamed';

const StreamActionsSettingsTab = lazyNamed(
  () => import('@/components/settings/tabs/StreamActionsSettingsTab'),
  'StreamActionsSettingsTab',
);
const StreamActionEditDialog = lazyNamed(
  () => import('@/components/settings/dialogs/StreamActionEditDialog'),
  'StreamActionEditDialog',
);

export function StreamActionsSection() {
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
      <StreamActionsSettingsTab
        actions={localSettings.stream_actions}
        onAdd={actionCrud.handleAdd}
        onEdit={actionCrud.handleEdit}
        onDelete={actionCrud.handleDelete}
        onToggle={handleToggle}
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
}
