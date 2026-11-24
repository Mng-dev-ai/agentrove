import { Suspense, useCallback, useState } from 'react';
import { Server, UserCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { useQueryClient } from '@tanstack/react-query';
import { ListManagementTab } from '@/components/ui/ListManagementTab/ListManagementTab';
import { useSettingsContext } from '@/hooks/useSettingsContext';
import { queryKeys } from '@/hooks/queries/queryKeys';
import {
  type MachineSettingsItem,
  useMachinesSettingsList,
  useUpdateMachineSettingsMutation,
} from '@/hooks/queries/useMachineQueries';
import { ValidationError } from '@/services/base/ServiceError';
import { LOCAL_MACHINE_ID } from '@/types/machine.types';
import { createDefaultPersonaForm, validatePersonaForm } from '@/utils/settings';
import { lazyNamed } from '@/utils/lazyNamed';
import { logger } from '@/utils/logger';
import type { Persona, PersonaForm } from '@/types/user.types';
import styles from './PersonasSettingsTab.module.scss';

const PersonaEditDialog = lazyNamed(
  () => import('@/components/settings/dialogs/PersonaEditDialog/PersonaEditDialog'),
  'PersonaEditDialog',
);

type MachinePersona = MachineSettingsItem<Persona>;

function createDefaultForm(machineId: string): PersonaForm {
  return { ...createDefaultPersonaForm(), machineId };
}

function savePersona(personas: Persona[], editingName: string | null, persona: Persona) {
  const index = editingName === null ? null : personas.findIndex((p) => p.name === editingName);
  if (index === -1) throw new ValidationError('This persona no longer exists');
  const error = validatePersonaForm(persona, index, personas);
  if (error) throw new ValidationError(error);
  return index === null
    ? [...personas, persona]
    : personas.map((p, i) => (i === index ? persona : p));
}

function deletePersona(personas: Persona[], name: string) {
  const remaining = personas.filter((p) => p.name !== name);
  return remaining.length > 0 ? remaining : null;
}

export function PersonasSettingsTab() {
  const { persistSettings } = useSettingsContext();
  const {
    machineOptions,
    machineName,
    machineId: machineFilter,
    filter,
    items,
    load: remoteLoad,
  } = useMachinesSettingsList('personas', 'No personas match these filters');
  const queryClient = useQueryClient();
  const remoteMutation = useUpdateMachineSettingsMutation({
    scope: { id: 'machine-personas' },
    onError: (_error, { machineId }) =>
      queryClient.invalidateQueries({ queryKey: queryKeys.machine.settings(machineId) }),
  });

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<MachinePersona | null>(null);
  const [form, setForm] = useState<PersonaForm>(() => createDefaultForm(LOCAL_MACHINE_ID));
  const [formError, setFormError] = useState<string | null>(null);

  const handleFormChange = useCallback(
    <K extends keyof PersonaForm>(field: K, value: PersonaForm[K]) => {
      setForm((prev) => ({ ...prev, [field]: value }));
    },
    [],
  );

  const handleAdd = () => {
    setEditingItem(null);
    setForm(createDefaultForm(machineFilter ?? LOCAL_MACHINE_ID));
    setFormError(null);
    setIsDialogOpen(true);
  };

  const writePersonas = async (
    machineId: string,
    update: (personas: Persona[]) => Persona[] | null,
    errorMessage: string,
  ) => {
    if (machineId === LOCAL_MACHINE_ID) {
      await persistSettings((prev) => ({ ...prev, personas: update(prev.personas ?? []) }), {
        errorMessage,
        versioned: true,
      });
      return;
    }
    try {
      await remoteMutation.mutateAsync({
        machineId,
        update: (settings) => ({ personas: update(settings.personas ?? []) }),
      });
    } catch (error) {
      if (!(error instanceof ValidationError)) toast.error(errorMessage);
      throw error;
    }
    toast.success('Saved', { id: 'settings-saved' });
  };

  const handleEdit = (index: number) => {
    const item = items?.[index];
    if (!item) return;
    setEditingItem(item);
    setForm({ ...item.entry, machineId: item.machineId });
    setFormError(null);
    setIsDialogOpen(true);
  };

  const handleDelete = async (index: number) => {
    const item = items?.[index];
    if (!item) return;
    try {
      await writePersonas(
        item.machineId,
        (personas) => deletePersona(personas, item.entry.name),
        'Failed to delete persona',
      );
    } catch (error) {
      logger.error('Failed to delete persona', 'PersonasSettingsTab', error);
    }
  };

  const handleSave = async () => {
    const persona: Persona = { name: form.name, content: form.content };
    const editingName = editingItem?.entry.name ?? null;
    try {
      await writePersonas(
        form.machineId,
        (personas) => savePersona(personas, editingName, persona),
        'Failed to save persona',
      );
      setIsDialogOpen(false);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'An unexpected error occurred');
    }
  };

  return (
    <>
      <ListManagementTab<MachinePersona>
        title="Personas"
        description="Create personas with custom system prompts. Select from the persona dropdown in the input bar. Claude, Codex, Grok, and OpenCode support replacing the system prompt; the persona selector is hidden for Cursor and Copilot."
        items={items}
        loadError={{ message: "Couldn't load personas", load: remoteLoad }}
        emptyIcon={UserCircle}
        emptyText="No personas configured yet"
        addButtonText="Add Persona"
        deleteConfirmTitle="Delete Persona"
        deleteConfirmMessage={(item) =>
          `Are you sure you want to delete "${item.entry.name}"? This action cannot be undone.`
        }
        getItemKey={(item) => `${item.machineId}:${item.entry.name}`}
        onAdd={handleAdd}
        onEdit={handleEdit}
        onDelete={handleDelete}
        filter={filter}
        renderItem={(item) => (
          <>
            <div className={styles['item-header']}>
              <h3 className={styles['item-title']}>{item.entry.name}</h3>
              {item.machineId !== LOCAL_MACHINE_ID && (
                <span className={styles.chip} title={machineName(item.machineId)}>
                  <Server className={styles['chip-icon']} />
                  <span className={styles['chip-label']}>{machineName(item.machineId)}</span>
                </span>
              )}
            </div>
            <p className={styles['item-content']}>{item.entry.content}</p>
          </>
        )}
        logContext="PersonasSettingsTab"
      />
      {isDialogOpen && (
        <Suspense fallback={null}>
          <PersonaEditDialog
            isOpen={isDialogOpen}
            isEditing={editingItem !== null}
            persona={form}
            machineOptions={machineOptions}
            error={formError}
            isSaving={remoteMutation.isPending}
            onClose={() => setIsDialogOpen(false)}
            onSubmit={() => void handleSave()}
            onPersonaChange={handleFormChange}
          />
        </Suspense>
      )}
    </>
  );
}
