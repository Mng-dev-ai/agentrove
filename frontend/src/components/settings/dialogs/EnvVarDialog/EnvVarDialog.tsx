import type { CustomEnvVar } from '@/types/user.types';
import { Input } from '@/components/ui/primitives/Input/Input';
import { Label } from '@/components/ui/primitives/Label/Label';
import { SecretInput } from '@/components/settings/inputs/SecretInput/SecretInput';
import { useState } from 'react';
import { BaseModal } from '@/components/ui/shared/BaseModal/BaseModal';
import { DialogFooter } from '@/components/ui/shared/DialogFooter/DialogFooter';
import { DialogError } from '@/components/ui/shared/DialogError/DialogError';
import styles from './EnvVarDialog.module.scss';

interface EnvVarDialogProps {
  isOpen: boolean;
  isEditing: boolean;
  envVar: CustomEnvVar;
  error: string | null;
  onClose: () => void;
  onSubmit: () => void;
  onEnvVarChange: <K extends keyof CustomEnvVar>(field: K, value: CustomEnvVar[K]) => void;
}

export function EnvVarDialog({
  isOpen,
  isEditing,
  envVar,
  error,
  onClose,
  onSubmit,
  onEnvVarChange,
}: EnvVarDialogProps) {
  const [isValueVisible, setIsValueVisible] = useState(false);

  return (
    <BaseModal isOpen={isOpen} onClose={onClose} size="lg" className={styles.dialog}>
      <div className={styles.body}>
        <h3 className={styles.title}>
          {isEditing ? 'Edit Environment Variable' : 'Add Environment Variable'}
        </h3>

        <DialogError error={error} className={styles.error} />

        <div className={styles.fields}>
          <div>
            <Label className={styles.label}>Variable Name</Label>
            <Input
              value={envVar.key}
              onChange={(e) => {
                const value = e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '');
                onEnvVarChange('key', value);
              }}
              placeholder="OPENAI_API_KEY"
              className={styles['key-input']}
            />
            <p className={styles.hint}>Uppercase letters, numbers, and underscores only</p>
          </div>

          <div>
            <Label className={styles.label}>Value</Label>
            <SecretInput
              value={envVar.value}
              onChange={(value) => onEnvVarChange('value', value)}
              placeholder="sk-..."
              isVisible={isValueVisible}
              onToggleVisibility={() => setIsValueVisible(!isValueVisible)}
              containerClassName={styles['secret-value']}
              inputClassName={styles['secret-mono']}
            />
            <p className={styles.hint}>Available in all sandboxes</p>
          </div>
        </div>

        <DialogFooter
          onCancel={onClose}
          onSave={onSubmit}
          saveLabel={isEditing ? 'Update' : 'Add Variable'}
          disabled={!envVar.key.trim() || !envVar.value.trim()}
        />
      </div>
    </BaseModal>
  );
}
