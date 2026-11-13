import { Suspense, useCallback, useMemo, useState } from 'react';
import { Brain, Pin, PinOff, Server } from 'lucide-react';
import toast from 'react-hot-toast';
import { ListManagementTab } from '@/components/ui/ListManagementTab/ListManagementTab';
import { Button } from '@/components/ui/primitives/Button/Button';
import type { ListFilterCategory } from '@/components/ui/ListManagementTab/ListFilterMenu';
import { useWorkspacesList } from '@/hooks/queries/useWorkspaceQueries';
import { useMachinesWorkspaces } from '@/hooks/queries/useMachineQueries';
import { machineFilterCategories } from '@/hooks/useMachineFilter';
import {
  type MachineMemory,
  type MemoryFilter,
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

function createDefaultForm(filter: MemoryFilter | null): MemoryForm {
  return {
    title: '',
    content: '',
    pinned: false,
    workspace_id: filter?.workspaceId ?? null,
    machineId: filter?.machineId ?? LOCAL_MACHINE_ID,
  };
}

function resolveFilter(
  filter: MemoryFilter | null,
  machineIds: string[],
  workspacesByMachine: Record<string, Workspace[]>,
): MemoryFilter | null {
  if (!filter || !machineIds.includes(filter.machineId)) return null;
  if (
    filter.workspaceId === null ||
    workspacesByMachine[filter.machineId]?.some((w) => w.id === filter.workspaceId)
  ) {
    return filter;
  }
  return { machineId: filter.machineId, workspaceId: null };
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
  const [filter, setFilter] = useState<MemoryFilter | null>(null);
  const activeFilter = resolveFilter(
    filter,
    machineOptions.map((machine) => machine.id),
    workspacesByMachine,
  );
  const items = useMemoriesAcrossMachines(activeFilter);

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

  const workspaceGroups = activeFilter
    ? [{ heading: null, options: workspacesByMachine[activeFilter.machineId] ?? [] }]
    : machineOptions.length > 1
      ? machineOptions
          .map((machine) => ({
            heading: machine.name,
            options: workspacesByMachine[machine.id] ?? [],
          }))
          .filter((group) => group.options.length > 0)
      : [{ heading: null, options: localWorkspaces }];

  const filterCategories: ListFilterCategory[] = [
    ...machineFilterCategories(machineOptions, activeFilter?.machineId ?? null, (machineId) =>
      setFilter(machineId ? { machineId, workspaceId: null } : null),
    ),
    {
      key: 'workspace',
      label: 'Workspace',
      allLabel: 'All workspaces',
      value: activeFilter?.workspaceId ?? null,
      groups: workspaceGroups,
      onChange: (workspaceId) => {
        const machineId = workspaceId
          ? machineOptions.find((machine) =>
              workspacesByMachine[machine.id]?.some((w) => w.id === workspaceId),
            )?.id
          : activeFilter?.machineId;
        setFilter(machineId ? { machineId, workspaceId } : null);
      },
    },
  ];

  const machineName = (machineId: string) => machineNames.get(machineId) ?? 'Machine';

  const workspaceName = (item: MachineMemory) =>
    item.memory.workspace_id
      ? (workspacesByMachine[item.machineId]?.find((w) => w.id === item.memory.workspace_id)
          ?.name ?? 'Workspace')
      : 'Global';

  const handleAdd = () => {
    setEditingItem(null);
    setForm(createDefaultForm(activeFilter));
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
        filter={{
          categories: filterCategories,
          onClear: () => setFilter(null),
          emptyText: 'No memories match these filters',
        }}
        renderItem={(item) => (
          <>
            <div className={styles['item-header']}>
              <h3 className={styles['item-title']}>{item.memory.title}</h3>
              {item.machineId !== LOCAL_MACHINE_ID && (
                <span className={styles.chip} title={machineName(item.machineId)}>
                  <Server className={styles['chip-icon']} />
                  <span className={styles['chip-label']}>{machineName(item.machineId)}</span>
                </span>
              )}
              <span className={styles.chip} title={workspaceName(item)}>
                <span className={styles['chip-label']}>{workspaceName(item)}</span>
              </span>
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
