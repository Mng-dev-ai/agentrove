import type { MemoryForm } from '@/types/memory.types';
import type { Workspace } from '@/types/workspace.types';
import { Input } from '@/components/ui/primitives/Input/Input';
import { Label } from '@/components/ui/primitives/Label/Label';
import { Select } from '@/components/ui/primitives/Select/Select';
import { Switch } from '@/components/ui/primitives/Switch/Switch';
import { Textarea } from '@/components/ui/primitives/Textarea/Textarea';
import { BaseModal } from '@/components/ui/shared/BaseModal/BaseModal';
import { DialogFooter } from '@/components/ui/shared/DialogFooter/DialogFooter';
import { DialogError } from '@/components/ui/shared/DialogError/DialogError';
import { machineName } from '@/store/machineStore';
import styles from './MemoryEditDialog.module.scss';

interface MemoryEditDialogProps {
  isOpen: boolean;
  isEditing: boolean;
  memory: MemoryForm;
  workspaces: Workspace[];
  machineOptions: { id: string; name: string }[];
  error: string | null;
  isSaving: boolean;
  onClose: () => void;
  onSubmit: () => void;
  onMemoryChange: <K extends keyof MemoryForm>(field: K, value: MemoryForm[K]) => void;
}

export function MemoryEditDialog({
  isOpen,
  isEditing,
  memory,
  workspaces,
  machineOptions,
  error,
  isSaving,
  onClose,
  onSubmit,
  onMemoryChange,
}: MemoryEditDialogProps) {
  const machineOffline = !machineOptions.some((machine) => machine.id === memory.machineId);
  const machines = machineOffline
    ? [
        ...machineOptions,
        { id: memory.machineId, name: `${machineName(memory.machineId)} (offline)` },
      ]
    : machineOptions;
  return (
    <BaseModal isOpen={isOpen} onClose={onClose} size="4xl" className={styles.dialog}>
      <div className={styles.body}>
        <h3 className={styles.title}>{isEditing ? 'Edit Memory' : 'Add Memory'}</h3>

        <DialogError
          error={error ?? (machineOffline ? "This memory's machine is offline" : null)}
          className={styles.error}
        />

        <div className={styles.fields}>
          <div>
            <Label className={styles.label}>Title</Label>
            <Input
              value={memory.title}
              onChange={(e) => onMemoryChange('title', e.target.value.replace(/[\r\n]/g, ''))}
              placeholder="Prefers pnpm over npm"
              maxLength={80}
              className={styles.input}
            />
          </div>

          <div>
            <Label className={styles.label}>Content</Label>
            <Textarea
              value={memory.content}
              onChange={(e) => onMemoryChange('content', e.target.value)}
              placeholder="Use pnpm for installs and scripts in every repo."
              maxLength={500}
              className={styles['content-textarea']}
              rows={6}
            />
            <p className={styles.hint}>{memory.content.length}/500 characters</p>
          </div>

          <div>
            <Label className={styles.label}>Scope</Label>
            <div className={styles.row}>
              {machines.length > 1 && (
                <Select
                  value={memory.machineId}
                  onChange={(e) => {
                    onMemoryChange('machineId', e.target.value);
                    onMemoryChange('workspace_id', null);
                  }}
                  className={styles.input}
                  aria-label="Machine"
                  disabled={isEditing}
                >
                  {machines.map((machine) => (
                    <option
                      key={machine.id}
                      value={machine.id}
                      disabled={machineOffline && machine.id === memory.machineId}
                    >
                      {machine.name}
                    </option>
                  ))}
                </Select>
              )}
              <Select
                value={memory.workspace_id ?? ''}
                onChange={(e) => onMemoryChange('workspace_id', e.target.value || null)}
                className={styles.input}
                aria-label="Scope"
              >
                <option value="">Global</option>
                {workspaces.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </Select>
            </div>
            <p className={styles.hint}>
              Global memories reach every chat; workspace memories only chats in that workspace
            </p>
          </div>

          <div className={styles['pinned-row']}>
            <div>
              <Label className={styles.label}>Pinned</Label>
              <p className={styles.hint}>Pinned memories are sent in full to every new session</p>
            </div>
            <Switch
              checked={memory.pinned}
              onCheckedChange={(pinned) => onMemoryChange('pinned', pinned)}
              aria-label="Pinned"
            />
          </div>
        </div>

        <DialogFooter
          onCancel={onClose}
          onSave={onSubmit}
          saveLabel={isEditing ? 'Update' : 'Add Memory'}
          saving={isSaving}
          disabled={!memory.title.trim() || !memory.content.trim() || machineOffline}
        />
      </div>
    </BaseModal>
  );
}
