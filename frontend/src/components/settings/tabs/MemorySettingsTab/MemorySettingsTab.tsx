import { Suspense, useCallback, useMemo, useState } from 'react';
import { Brain, Pin, PinOff, Server } from 'lucide-react';
import toast from 'react-hot-toast';
import { ListManagementTab } from '@/components/ui/ListManagementTab/ListManagementTab';
import { Button } from '@/components/ui/primitives/Button/Button';
import { Select } from '@/components/ui/primitives/Select/Select';
import { useWorkspacesList } from '@/hooks/queries/useWorkspaceQueries';
import { useMachinesWorkspaces } from '@/hooks/queries/useMachineQueries';
import {
  type MachineMemory,
  type MemoryWorkspaceFilter,
  useCreateMemoryMutation,
  useDeleteMemoryMutation,
  useMemoriesAcrossMachines,
  useUpdateMemoryMutation,
} from '@/hooks/queries/useMemoryQueries';
import {
  LOCAL_MACHINE_NAME,
  useMachineStore,
  useOnlineRemoteMachineIds,
} from '@/store/machineStore';
import { LOCAL_MACHINE_ID } from '@/types/machine.types';
import { lazyNamed } from '@/utils/lazyNamed';
import type { MemoryCreateRequest, MemoryForm } from '@/types/memory.types';
import type { Workspace } from '@/types/workspace.types';
import styles from './MemorySettingsTab.module.scss';

const MemoryEditDialog = lazyNamed(
  () => import('@/components/settings/dialogs/MemoryEditDialog/MemoryEditDialog'),
  'MemoryEditDialog',
);

function createDefaultForm(filter: MemoryWorkspaceFilter | null): MemoryForm {
  return {
    title: '',
    content: '',
    pinned: false,
    workspace_id: filter?.workspaceId ?? null,
    machineId: filter?.machineId ?? LOCAL_MACHINE_ID,
  };
}

export function MemorySettingsTab() {
  const localWorkspaces = useWorkspacesList();
  const remoteIds = useOnlineRemoteMachineIds();
  const remoteWorkspaces = useMachinesWorkspaces(remoteIds, true);
  const machines = useMachineStore((state) => state.machines);
  const machineNames = useMemo(
    () => new Map(machines.map((machine) => [machine.id, machine.name])),
    [machines],
  );
  const machineOptions = useMemo(
    () => [
      { id: LOCAL_MACHINE_ID, name: LOCAL_MACHINE_NAME },
      ...remoteIds.map((id) => ({ id, name: machineNames.get(id) ?? 'Machine' })),
    ],
    [remoteIds, machineNames],
  );
  const workspacesByMachine = useMemo(
    (): Record<string, Workspace[]> => ({
      ...remoteWorkspaces,
      [LOCAL_MACHINE_ID]: localWorkspaces,
    }),
    [remoteWorkspaces, localWorkspaces],
  );
  const [workspaceFilter, setWorkspaceFilter] = useState<MemoryWorkspaceFilter | null>(null);
  const items = useMemoriesAcrossMachines(workspaceFilter);

  const createMutation = useCreateMemoryMutation();
  const updateMutation = useUpdateMemoryMutation();
  const deleteMutation = useDeleteMemoryMutation();

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<MachineMemory | null>(null);
  const [form, setForm] = useState<MemoryForm>(() => createDefaultForm(null));
  const [formError, setFormError] = useState<string | null>(null);

  const handleFormChange = useCallback(
    <K extends keyof MemoryForm>(field: K, value: MemoryForm[K]) => {
      setForm((prev) => ({ ...prev, [field]: value }));
    },
    [],
  );

  const handleFilterChange = (workspaceId: string) => {
    const machineId = machineOptions.find((machine) =>
      workspacesByMachine[machine.id]?.some((w) => w.id === workspaceId),
    )?.id;
    setWorkspaceFilter(machineId ? { machineId, workspaceId } : null);
  };

  const workspaceName = (item: MachineMemory) =>
    item.memory.workspace_id
      ? (workspacesByMachine[item.machineId]?.find((w) => w.id === item.memory.workspace_id)
          ?.name ?? 'Workspace')
      : 'Global';

  const handleAdd = () => {
    setEditingItem(null);
    setForm(createDefaultForm(workspaceFilter));
    setFormError(null);
    setIsDialogOpen(true);
  };

  const handleEdit = (index: number) => {
    const item = items?.[index];
    if (!item) return;
    setEditingItem(item);
    setForm({
      title: item.memory.title,
      content: item.memory.content,
      pinned: item.memory.pinned,
      workspace_id: item.memory.workspace_id,
      machineId: item.machineId,
    });
    setFormError(null);
    setIsDialogOpen(true);
  };

  const handleDelete = async (index: number) => {
    const item = items?.[index];
    if (!item) return;
    await deleteMutation.mutateAsync({ memoryId: item.memory.id, machineId: item.machineId });
  };

  const handleSave = async () => {
    const data: MemoryCreateRequest = {
      title: form.title.trim(),
      content: form.content.trim(),
      pinned: form.pinned,
      workspace_id: form.workspace_id,
    };
    try {
      if (editingItem) {
        await updateMutation.mutateAsync({
          memoryId: editingItem.memory.id,
          data,
          machineId: editingItem.machineId,
        });
      } else {
        await createMutation.mutateAsync({ data, machineId: form.machineId });
      }
      setIsDialogOpen(false);
      toast.success('Saved', { id: 'memory-saved' });
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Failed to save memory');
    }
  };

  const handleTogglePinned = async (item: MachineMemory) => {
    try {
      await updateMutation.mutateAsync({
        memoryId: item.memory.id,
        data: { pinned: !item.memory.pinned },
        machineId: item.machineId,
      });
    } catch {
      toast.error('Failed to update memory');
    }
  };

  return (
    <>
      <ListManagementTab<MachineMemory>
        title="Memory"
        description="Durable facts agents remember across every provider and chat — preferences, corrections, and repo conventions. Agents save and search them with the AgentRove MCP tools; pinned memories are sent in full to every new session."
        items={items}
        emptyIcon={Brain}
        emptyText="No memories saved yet"
        emptyButtonText="Add Your First Memory"
        addButtonText="Add Memory"
        deleteConfirmTitle="Delete Memory"
        deleteConfirmMessage={(item) =>
          `Are you sure you want to delete "${item.memory.title}"? This action cannot be undone.`
        }
        getItemKey={(item) => item.memory.id}
        onAdd={handleAdd}
        onEdit={handleEdit}
        onDelete={handleDelete}
        headerContent={
          <div className={styles.filter}>
            <Select
              value={workspaceFilter?.workspaceId ?? ''}
              onChange={(e) => handleFilterChange(e.target.value)}
              aria-label="Filter by workspace"
              className={styles['filter-select']}
            >
              <option value="">All workspaces</option>
              {machineOptions.length > 1
                ? machineOptions.map((machine) => (
                    <optgroup key={machine.id} label={machine.name}>
                      {workspacesByMachine[machine.id]?.map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.name}
                        </option>
                      ))}
                    </optgroup>
                  ))
                : localWorkspaces.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
            </Select>
          </div>
        }
        renderItem={(item) => (
          <>
            <div className={styles['item-header']}>
              <h3 className={styles['item-title']}>{item.memory.title}</h3>
              {item.machineId !== LOCAL_MACHINE_ID && (
                <span className={styles.chip}>
                  <Server className={styles['chip-icon']} />
                  {machineNames.get(item.machineId) ?? 'Machine'}
                </span>
              )}
              <span className={styles.chip}>{workspaceName(item)}</span>
              {item.memory.pinned && (
                <span className={styles.chip}>
                  <Pin className={styles['chip-icon']} />
                  Pinned
                </span>
              )}
            </div>
            <p className={styles['item-content']}>{item.memory.content}</p>
          </>
        )}
        renderItemActions={(item) => (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => void handleTogglePinned(item)}
            className={styles['pin-btn']}
            aria-label={item.memory.pinned ? 'Unpin memory' : 'Pin memory'}
            title={item.memory.pinned ? 'Unpin' : 'Pin'}
          >
            {item.memory.pinned ? (
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
            isEditing={editingItem !== null}
            memory={form}
            workspaces={workspacesByMachine[form.machineId] ?? []}
            machineOptions={machineOptions}
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
