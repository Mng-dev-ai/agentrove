import { useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { useQueryClient } from '@tanstack/react-query';
import { Label } from '@/components/ui/primitives/Label/Label';
import { Select } from '@/components/ui/primitives/Select/Select';
import { Spinner } from '@/components/ui/primitives/Spinner/Spinner';
import { Textarea } from '@/components/ui/primitives/Textarea/Textarea';
import { LoadErrorState } from '@/components/ui/shared/LoadErrorState/LoadErrorState';
import { useDraftField } from '@/hooks/useDraftField';
import { useDefaultMachineId } from '@/hooks/useMachineFilter';
import { listLoadState } from '@/hooks/queries/listLoad';
import { queryKeys } from '@/hooks/queries/queryKeys';
import {
  useMachineSettingsQuery,
  useUpdateMachineSettingsMutation,
} from '@/hooks/queries/useMachineQueries';
import {
  LOCAL_MACHINE_NAME,
  useMachineStore,
  useOnlineRemoteMachineIds,
} from '@/store/machineStore';
import { LOCAL_MACHINE_ID } from '@/types/machine.types';
import styles from './InstructionsSettingsTab.module.scss';

interface InstructionsSettingsTabProps {
  instructions: string;
  onPersist: (value: string) => void;
}

function InstructionsField({ instructions, onPersist }: InstructionsSettingsTabProps) {
  const { draft, setDraft, handleBlur } = useDraftField(instructions, onPersist);

  return (
    <Textarea
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={handleBlur}
      placeholder="Enter custom instructions for how the AI should behave, respond, or approach tasks..."
      rows={8}
      className={styles.textarea}
    />
  );
}

export function InstructionsSettingsTab({ instructions, onPersist }: InstructionsSettingsTabProps) {
  const remoteIds = useOnlineRemoteMachineIds();
  const machines = useMachineStore((state) => state.machines);
  const machineOptions = useMemo(
    () => [
      { id: LOCAL_MACHINE_ID, name: LOCAL_MACHINE_NAME },
      ...remoteIds.map((id) => ({
        id,
        name: machines.find((machine) => machine.id === id)?.name ?? 'Machine',
      })),
    ],
    [remoteIds, machines],
  );
  const defaultId = useDefaultMachineId(machineOptions) ?? LOCAL_MACHINE_ID;
  const [selectedId, setSelectedId] = useState<string>();
  const machineId =
    selectedId && machineOptions.some((machine) => machine.id === selectedId)
      ? selectedId
      : defaultId;
  const isRemote = machineId !== LOCAL_MACHINE_ID;

  const remoteQuery = useMachineSettingsQuery(machineId, isRemote);
  const remoteLoad = listLoadState([remoteQuery]);
  const queryClient = useQueryClient();
  const remoteMutation = useUpdateMachineSettingsMutation({
    scope: { id: 'machine-instructions' },
    onError: (_error, variables) =>
      queryClient.invalidateQueries({ queryKey: queryKeys.machine.settings(variables.machineId) }),
  });

  const persistRemote = (value: string) => {
    remoteMutation
      .mutateAsync({ machineId, update: () => ({ custom_instructions: value || null }) })
      .then(
        () => toast.success('Saved', { id: 'settings-saved' }),
        () => toast.error('Failed to save instructions'),
      );
  };

  return (
    <div className={styles.instructions}>
      <div>
        <h2 className={styles.title}>Custom Instructions</h2>
        <p className={styles.description}>
          These instructions will be added to every conversation with the AI.
        </p>
      </div>
      <div className={styles.fields}>
        {machineOptions.length > 1 && (
          <div>
            <Label className={styles.label}>Machine</Label>
            <Select
              value={machineId}
              onChange={(e) => setSelectedId(e.target.value)}
              className={styles.select}
              aria-label="Machine"
            >
              {machineOptions.map((machine) => (
                <option key={machine.id} value={machine.id}>
                  {machine.name}
                </option>
              ))}
            </Select>
          </div>
        )}
        <div>
          <Label className={styles.label}>Instructions for the AI assistant</Label>
          {!isRemote ? (
            <InstructionsField key={machineId} instructions={instructions} onPersist={onPersist} />
          ) : remoteQuery.data ? (
            <InstructionsField
              key={machineId}
              instructions={remoteQuery.data.custom_instructions || ''}
              onPersist={persistRemote}
            />
          ) : remoteLoad.loadFailed ? (
            <LoadErrorState
              variant="inline"
              message="Couldn't load instructions"
              load={remoteLoad}
            />
          ) : (
            <div className={styles.loading}>
              <Spinner size="md" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
