import { Suspense } from 'react';
import { Key } from 'lucide-react';
import { ListManagementTab } from '@/components/ui/ListManagementTab/ListManagementTab';
import { useSettingsContext } from '@/hooks/useSettingsContext';
import { useCrudForm } from '@/hooks/useCrudForm';
import { createDefaultEnvVarForm, validateEnvVarForm } from '@/utils/settings';
import { lazyNamed } from '@/utils/lazyNamed';
import type { CustomEnvVar } from '@/types/user.types';
import styles from './EnvVarsSettingsTab.module.scss';

const EnvVarDialog = lazyNamed(
  () => import('@/components/settings/dialogs/EnvVarDialog/EnvVarDialog'),
  'EnvVarDialog',
);

const maskValue = (value: string) => {
  if (value.length <= 4) return '····';
  return `${value.slice(0, 4)}${'·'.repeat(Math.min(value.length - 4, 16))}`;
};

export function EnvVarsSettingsTab() {
  const { localSettings, persistSettings } = useSettingsContext();

  const envVarCrud = useCrudForm(localSettings, persistSettings, {
    createDefault: createDefaultEnvVarForm,
    validateForm: (form, editingIndex) =>
      validateEnvVarForm(form, editingIndex, localSettings.custom_env_vars ?? []),
    getArrayKey: 'custom_env_vars',
    itemName: 'environment variable',
  });

  return (
    <>
      <ListManagementTab<CustomEnvVar>
        title="Environment Variables"
        description="Configure environment variables that will be available in every sandbox. Perfect for API keys like OPENAI_API_KEY, GEMINI_API_KEY, etc."
        items={localSettings.custom_env_vars ?? []}
        emptyIcon={Key}
        emptyText="No custom environment variables configured yet"
        emptyButtonText="Add Your First Environment Variable"
        addButtonText="Add Variable"
        deleteConfirmTitle="Delete Environment Variable"
        deleteConfirmMessage={(envVar) =>
          `Are you sure you want to delete "${envVar.key}"? This action cannot be undone.`
        }
        getItemKey={(envVar) => envVar.key}
        onAdd={envVarCrud.handleAdd}
        onEdit={envVarCrud.handleEdit}
        onDelete={envVarCrud.handleDelete}
        renderItem={(envVar) => (
          <>
            <div className={styles['item-header']}>
              <h3 className={styles['item-key']}>{envVar.key}</h3>
            </div>
            <p className={styles['item-value']}>{maskValue(envVar.value)}</p>
          </>
        )}
        logContext="EnvVarsSettingsTab"
      />
      {envVarCrud.isDialogOpen && (
        <Suspense fallback={null}>
          <EnvVarDialog
            isOpen={envVarCrud.isDialogOpen}
            isEditing={envVarCrud.editingIndex !== null}
            envVar={envVarCrud.form}
            error={envVarCrud.formError}
            onClose={envVarCrud.handleDialogClose}
            onSubmit={envVarCrud.handleSave}
            onEnvVarChange={envVarCrud.handleFormChange}
          />
        </Suspense>
      )}
    </>
  );
}
