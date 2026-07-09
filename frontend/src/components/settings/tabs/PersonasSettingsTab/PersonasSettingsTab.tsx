import { Suspense } from 'react';
import { UserCircle } from 'lucide-react';
import { ListManagementTab } from '@/components/ui/ListManagementTab/ListManagementTab';
import { useSettingsContext } from '@/hooks/useSettingsContext';
import { useCrudForm } from '@/hooks/useCrudForm';
import { createDefaultPersonaForm, validatePersonaForm } from '@/utils/settings';
import { lazyNamed } from '@/utils/lazyNamed';
import type { Persona } from '@/types/user.types';
import styles from './PersonasSettingsTab.module.scss';

const PersonaEditDialog = lazyNamed(
  () => import('@/components/settings/dialogs/PersonaEditDialog/PersonaEditDialog'),
  'PersonaEditDialog',
);

export const PersonasSettingsTab: React.FC = () => {
  const { localSettings, persistSettings } = useSettingsContext();

  const personaCrud = useCrudForm(localSettings, persistSettings, {
    createDefault: createDefaultPersonaForm,
    validateForm: (form, editingIndex) =>
      validatePersonaForm(form, editingIndex, localSettings.personas ?? []),
    getArrayKey: 'personas',
    itemName: 'persona',
  });

  return (
    <>
      <ListManagementTab<Persona>
        title="Personas"
        description="Create personas with custom system prompts. Select from the persona dropdown in the input bar. Claude, Codex, and OpenCode support replacing the system prompt; the persona selector is hidden for Cursor and Copilot."
        items={localSettings.personas ?? []}
        emptyIcon={UserCircle}
        emptyText="No personas configured yet"
        emptyButtonText="Create Your First Persona"
        addButtonText="Add Persona"
        deleteConfirmTitle="Delete Persona"
        deleteConfirmMessage={(persona) =>
          `Are you sure you want to delete "${persona.name}"? This action cannot be undone.`
        }
        getItemKey={(persona) => persona.name}
        onAdd={personaCrud.handleAdd}
        onEdit={personaCrud.handleEdit}
        onDelete={personaCrud.handleDelete}
        renderItem={(persona) => (
          <>
            <h3 className={styles['item-title']}>{persona.name}</h3>
            <p className={styles['item-content']}>{persona.content}</p>
          </>
        )}
        logContext="PersonasSettingsTab"
      />
      {personaCrud.isDialogOpen && (
        <Suspense fallback={null}>
          <PersonaEditDialog
            isOpen={personaCrud.isDialogOpen}
            isEditing={personaCrud.editingIndex !== null}
            persona={personaCrud.form}
            error={personaCrud.formError}
            onClose={personaCrud.handleDialogClose}
            onSubmit={personaCrud.handleSave}
            onPersonaChange={personaCrud.handleFormChange}
          />
        </Suspense>
      )}
    </>
  );
};
