import type { MemoryCreateRequest } from '@/types/memory.types';
import type { Workspace } from '@/types/workspace.types';
import { Input } from '@/components/ui/primitives/Input/Input';
import { Label } from '@/components/ui/primitives/Label/Label';
import { Select } from '@/components/ui/primitives/Select/Select';
import { Switch } from '@/components/ui/primitives/Switch/Switch';
import { Textarea } from '@/components/ui/primitives/Textarea/Textarea';
import { BaseModal } from '@/components/ui/shared/BaseModal/BaseModal';
import { DialogFooter } from '@/components/ui/shared/DialogFooter/DialogFooter';
import { DialogError } from '@/components/ui/shared/DialogError/DialogError';
import styles from './MemoryEditDialog.module.scss';

interface MemoryEditDialogProps {
  isOpen: boolean;
  isEditing: boolean;
  memory: MemoryCreateRequest;
  workspaces: Workspace[];
  error: string | null;
  isSaving: boolean;
  onClose: () => void;
  onSubmit: () => void;
  onMemoryChange: <K extends keyof MemoryCreateRequest>(
    field: K,
    value: MemoryCreateRequest[K],
  ) => void;
}

export function MemoryEditDialog({
  isOpen,
  isEditing,
  memory,
  workspaces,
  error,
  isSaving,
  onClose,
  onSubmit,
  onMemoryChange,
}: MemoryEditDialogProps) {
  return (
    <BaseModal isOpen={isOpen} onClose={onClose} size="4xl" className={styles.dialog}>
      <div className={styles.body}>
        <h3 className={styles.title}>{isEditing ? 'Edit Memory' : 'Add Memory'}</h3>

        <DialogError error={error} className={styles.error} />

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
            <Select
              value={memory.workspace_id ?? ''}
              onChange={(e) => onMemoryChange('workspace_id', e.target.value || null)}
              className={styles.input}
            >
              <option value="">Global</option>
              {workspaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </Select>
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
          disabled={!memory.title.trim() || !memory.content.trim()}
        />
      </div>
    </BaseModal>
  );
}
