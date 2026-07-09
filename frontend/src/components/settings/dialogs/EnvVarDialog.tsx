import type { CustomEnvVar } from '@/types/user.types';
import { Input } from '@/components/ui/primitives/Input/Input';
import { Label } from '@/components/ui/primitives/Label/Label';
import { SecretInput } from '../inputs/SecretInput';
import { useState } from 'react';
import { BaseModal } from '@/components/ui/shared/BaseModal';
import { DialogFooter } from '@/components/ui/shared/DialogFooter';
import { DialogError } from '@/components/ui/shared/DialogError';

interface EnvVarDialogProps {
  isOpen: boolean;
  isEditing: boolean;
  envVar: CustomEnvVar;
  error: string | null;
  onClose: () => void;
  onSubmit: () => void;
  onEnvVarChange: <K extends keyof CustomEnvVar>(field: K, value: CustomEnvVar[K]) => void;
}

export const EnvVarDialog: React.FC<EnvVarDialogProps> = ({
  isOpen,
  isEditing,
  envVar,
  error,
  onClose,
  onSubmit,
  onEnvVarChange,
}) => {
  const [isValueVisible, setIsValueVisible] = useState(false);

  return (
    <BaseModal isOpen={isOpen} onClose={onClose} size="lg" className="max-h-[90vh] overflow-y-auto">
      <div className="p-5">
        <h3 className="mb-5 text-sm font-medium text-text-primary dark:text-text-dark-primary">
          {isEditing ? 'Edit Environment Variable' : 'Add Environment Variable'}
        </h3>

        <DialogError error={error} className="mb-4" />

        <div className="space-y-4">
          <div>
            <Label className="mb-1.5 text-xs text-text-secondary dark:text-text-dark-secondary">
              Variable Name
            </Label>
            <Input
              value={envVar.key}
              onChange={(e) => {
                const value = e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '');
                onEnvVarChange('key', value);
              }}
              placeholder="OPENAI_API_KEY"
              className="font-mono text-xs"
            />
            <p className="mt-1 text-2xs text-text-quaternary dark:text-text-dark-quaternary">
              Uppercase letters, numbers, and underscores only
            </p>
          </div>

          <div>
            <Label className="mb-1.5 text-xs text-text-secondary dark:text-text-dark-secondary">
              Value
            </Label>
            <SecretInput
              value={envVar.value}
              onChange={(value) => onEnvVarChange('value', value)}
              placeholder="sk-..."
              isVisible={isValueVisible}
              onToggleVisibility={() => setIsValueVisible(!isValueVisible)}
              containerClassName="w-full"
              inputClassName="font-mono"
            />
            <p className="mt-1 text-2xs text-text-quaternary dark:text-text-dark-quaternary">
              Available in all sandboxes
            </p>
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
};
