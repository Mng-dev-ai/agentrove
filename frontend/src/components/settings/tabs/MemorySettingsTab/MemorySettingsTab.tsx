import { Suspense, useCallback, useMemo, useState } from 'react';
import { Brain, Pin, PinOff } from 'lucide-react';
import toast from 'react-hot-toast';
import { ListManagementTab } from '@/components/ui/ListManagementTab/ListManagementTab';
import { Button } from '@/components/ui/primitives/Button/Button';
import { Select } from '@/components/ui/primitives/Select/Select';
import { useWorkspacesList } from '@/hooks/queries/useWorkspaceQueries';
import {
  useCreateMemoryMutation,
  useDeleteMemoryMutation,
  useMemoriesQuery,
  useUpdateMemoryMutation,
} from '@/hooks/queries/useMemoryQueries';
import { lazyNamed } from '@/utils/lazyNamed';
import type { Memory, MemoryCreateRequest, MemoryForm } from '@/types/memory.types';
import styles from './MemorySettingsTab.module.scss';

const MemoryEditDialog = lazyNamed(
  () => import('@/components/settings/dialogs/MemoryEditDialog/MemoryEditDialog'),
  'MemoryEditDialog',
);

function createDefaultForm(workspaceId: string | null): MemoryForm {
  return { title: '', content: '', pinned: false, workspace_id: workspaceId };
}

export function MemorySettingsTab() {
  const workspaces = useWorkspacesList();
  const [workspaceFilter, setWorkspaceFilter] = useState<string | null>(null);
  const { data: memories } = useMemoriesQuery(workspaceFilter);

  const createMutation = useCreateMemoryMutation();
  const updateMutation = useUpdateMemoryMutation();
  const deleteMutation = useDeleteMemoryMutation();

  const workspaceNames = useMemo(
    () => new Map(workspaces.map((w) => [w.id, w.name])),
    [workspaces],
  );

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingMemory, setEditingMemory] = useState<Memory | null>(null);
  const [form, setForm] = useState<MemoryForm>(() => createDefaultForm(null));
  const [formError, setFormError] = useState<string | null>(null);

  const handleFormChange = useCallback(
    <K extends keyof MemoryForm>(field: K, value: MemoryForm[K]) => {
      setForm((prev) => ({ ...prev, [field]: value }));
    },
    [],
  );

  const handleAdd = () => {
    setEditingMemory(null);
    setForm(createDefaultForm(workspaceFilter));
    setFormError(null);
    setIsDialogOpen(true);
  };

  const handleEdit = (index: number) => {
    const memory = memories?.[index];
    if (!memory) return;
    setEditingMemory(memory);
    setForm({
      title: memory.title,
      content: memory.content,
      pinned: memory.pinned,
      workspace_id: memory.workspace_id,
    });
    setFormError(null);
    setIsDialogOpen(true);
  };

  const handleDelete = async (index: number) => {
    const memory = memories?.[index];
    if (!memory) return;
    await deleteMutation.mutateAsync(memory.id);
  };

  const handleSave = async () => {
    const data: MemoryCreateRequest = {
      title: form.title.trim(),
      content: form.content.trim(),
      pinned: form.pinned,
      scope: form.workspace_id ? 'workspace' : 'global',
      workspace_id: form.workspace_id,
    };
    try {
      if (editingMemory) {
        await updateMutation.mutateAsync({ memoryId: editingMemory.id, data });
      } else {
        await createMutation.mutateAsync(data);
      }
      setIsDialogOpen(false);
      toast.success('Saved', { id: 'memory-saved' });
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Failed to save memory');
    }
  };

  const handleTogglePinned = async (memory: Memory) => {
    try {
      await updateMutation.mutateAsync({
        memoryId: memory.id,
        data: { pinned: !memory.pinned },
      });
    } catch {
      toast.error('Failed to update memory');
    }
  };

  return (
    <>
      <ListManagementTab<Memory>
        title="Memory"
        description="Durable facts agents remember across every provider and chat — preferences, corrections, and repo conventions. Agents save and search them with the AgentRove MCP tools; pinned memories are sent in full to every new session."
        items={memories ?? null}
        emptyIcon={Brain}
        emptyText="No memories saved yet"
        emptyButtonText="Add Your First Memory"
        addButtonText="Add Memory"
        deleteConfirmTitle="Delete Memory"
        deleteConfirmMessage={(memory) =>
          `Are you sure you want to delete "${memory.title}"? This action cannot be undone.`
        }
        getItemKey={(memory) => memory.id}
        onAdd={handleAdd}
        onEdit={handleEdit}
        onDelete={handleDelete}
        headerContent={
          <div className={styles.filter}>
            <Select
              value={workspaceFilter ?? ''}
              onChange={(e) => setWorkspaceFilter(e.target.value || null)}
              aria-label="Filter by workspace"
              className={styles['filter-select']}
            >
              <option value="">All workspaces</option>
              {workspaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </Select>
          </div>
        }
        renderItem={(memory) => (
          <>
            <div className={styles['item-header']}>
              <h3 className={styles['item-title']}>{memory.title}</h3>
              <span className={styles.chip}>
                {memory.workspace_id
                  ? (workspaceNames.get(memory.workspace_id) ?? 'Workspace')
                  : 'Global'}
              </span>
              {memory.pinned && (
                <span className={styles.chip}>
                  <Pin className={styles['chip-icon']} />
                  Pinned
                </span>
              )}
            </div>
            <p className={styles['item-content']}>{memory.content}</p>
          </>
        )}
        renderItemActions={(memory) => (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => void handleTogglePinned(memory)}
            className={styles['pin-btn']}
            aria-label={memory.pinned ? 'Unpin memory' : 'Pin memory'}
            title={memory.pinned ? 'Unpin' : 'Pin'}
          >
            {memory.pinned ? (
              <PinOff className={styles['pin-icon']} />
            ) : (
              <Pin className={styles['pin-icon']} />
            )}
          </Button>
        )}
        logContext="MemorySettingsTab"
      />
      {isDialogOpen && (
        <Suspense fallback={null}>
          <MemoryEditDialog
            isOpen={isDialogOpen}
            isEditing={editingMemory !== null}
            memory={form}
            workspaces={workspaces}
            error={formError}
            isSaving={createMutation.isPending || updateMutation.isPending}
            onClose={() => setIsDialogOpen(false)}
            onSubmit={() => void handleSave()}
            onMemoryChange={handleFormChange}
          />
        </Suspense>
      )}
    </>
  );
}
