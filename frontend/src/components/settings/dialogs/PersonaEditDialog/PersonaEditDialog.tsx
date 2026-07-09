import type { Persona } from '@/types/user.types';
import { Input } from '@/components/ui/primitives/Input/Input';
import { Label } from '@/components/ui/primitives/Label/Label';
import { Textarea } from '@/components/ui/primitives/Textarea/Textarea';
import { BaseModal } from '@/components/ui/shared/BaseModal/BaseModal';
import { DialogFooter } from '@/components/ui/shared/DialogFooter/DialogFooter';
import { DialogError } from '@/components/ui/shared/DialogError/DialogError';
import styles from './PersonaEditDialog.module.scss';

interface PersonaEditDialogProps {
  isOpen: boolean;
  isEditing: boolean;
  persona: Persona;
  error: string | null;
  onClose: () => void;
  onSubmit: () => void;
  onPersonaChange: <K extends keyof Persona>(field: K, value: Persona[K]) => void;
}

export const PersonaEditDialog: React.FC<PersonaEditDialogProps> = ({
  isOpen,
  isEditing,
  persona,
  error,
  onClose,
  onSubmit,
  onPersonaChange,
}) => {
  return (
    <BaseModal isOpen={isOpen} onClose={onClose} size="4xl" className={styles.dialog}>
      <div className={styles.body}>
        <h3 className={styles.title}>{isEditing ? 'Edit Persona' : 'Add Persona'}</h3>

        <DialogError error={error} className={styles.error} />

        <div className={styles.fields}>
          <div>
            <Label className={styles.label}>Name</Label>
            <Input
              value={persona.name}
              onChange={(e) => onPersonaChange('name', e.target.value)}
              placeholder="code-reviewer"
              className={styles.input}
            />
            <p className={styles.hint}>Select from the persona dropdown in the input bar</p>
          </div>

          <div>
            <Label className={styles.label}>Content</Label>
            <Textarea
              value={persona.content}
              onChange={(e) => onPersonaChange('content', e.target.value)}
              placeholder="You are an expert code reviewer..."
              className={styles['content-textarea']}
              rows={15}
            />
          </div>
        </div>

        <DialogFooter
          onCancel={onClose}
          onSave={onSubmit}
          saveLabel={isEditing ? 'Update' : 'Add Persona'}
          disabled={!persona.name.trim() || !persona.content.trim()}
        />
      </div>
    </BaseModal>
  );
};
