import { useDraftField } from '@/hooks/useDraftField';
import { Button } from '@/components/ui/primitives/Button/Button';
import { Switch } from '@/components/ui/primitives/Switch/Switch';
import { SectionCard, SettingRow } from '@/components/settings/SettingsCard/SettingsCard';
import type { ApiFieldKey, GeneralSecretFieldConfig } from '@/types/settings.types';
import type { UserSettings } from '@/types/user.types';
import { SecretInput } from '@/components/settings/inputs/SecretInput/SecretInput';
import { ModelSelector } from '@/components/chat/model-selector/ModelSelector';
import styles from './GeneralSettingsTab.module.scss';

interface GeneralSettingsTabProps {
  fields: GeneralSecretFieldConfig[];
  settings: UserSettings;
  revealedFields: Record<ApiFieldKey, boolean>;
  onPersistSecret: (field: ApiFieldKey, value: string) => void;
  onToggleVisibility: (field: ApiFieldKey) => void;
  onDeleteAllChats: () => void;
  onAutoSteerQueuedMessagesChange: (enabled: boolean) => void;
  onTitleModelChange: (modelId: string) => void;
}

function SecretField({
  field,
  savedValue,
  isVisible,
  onPersist,
  onToggleVisibility,
}: {
  field: GeneralSecretFieldConfig;
  savedValue: string;
  isVisible: boolean;
  onPersist: (field: ApiFieldKey, value: string) => void;
  onToggleVisibility: (field: ApiFieldKey) => void;
}) {
  const { draft, setDraft, handleBlur } = useDraftField(savedValue, (v) => onPersist(field.key, v));

  return (
    <div className={styles.row}>
      <h3 className={styles['setting-title']}>{field.label}</h3>
      <p className={styles['field-desc']}>{field.description}</p>
      <SecretInput
        value={draft}
        placeholder={field.placeholder}
        isVisible={isVisible}
        onChange={setDraft}
        onBlur={handleBlur}
        onToggleVisibility={() => onToggleVisibility(field.key)}
        helperText={field.helperText}
      />
    </div>
  );
}

export function GeneralSettingsTab({
  fields,
  settings,
  revealedFields,
  onPersistSecret,
  onToggleVisibility,
  onDeleteAllChats,
  onAutoSteerQueuedMessagesChange,
  onTitleModelChange,
}: GeneralSettingsTabProps) {
  return (
    <div className={styles.general}>
      <h2 className={styles['page-title']}>General</h2>

      <SectionCard title="API Keys & Authentication">
        {fields.map((field) => (
          <SecretField
            key={field.key}
            field={field}
            savedValue={settings[field.key] ?? ''}
            isVisible={revealedFields[field.key]}
            onPersist={onPersistSecret}
            onToggleVisibility={onToggleVisibility}
          />
        ))}
      </SectionCard>

      <SectionCard title="Preferences">
        <SettingRow
          title="Auto-steer queued messages"
          desc="Send messages typed while agents are working immediately instead of queuing them until they finish."
        >
          <Switch
            checked={settings.auto_steer_queued_messages}
            onCheckedChange={onAutoSteerQueuedMessagesChange}
            aria-label="Auto-steer queued messages"
          />
        </SettingRow>
        <SettingRow title="Title Generation Model" desc="Model used to generate chat titles.">
          <ModelSelector
            selectedModelId={settings.title_model_id}
            onModelChange={onTitleModelChange}
            compact={false}
            dropdownAlign="right"
          />
        </SettingRow>
      </SectionCard>

      <SectionCard title="Data Management">
        <SettingRow
          title="Delete All Chats"
          desc="Permanently delete all chat history. This action cannot be undone."
        >
          <Button type="button" onClick={onDeleteAllChats} variant="outline" size="sm">
            Delete All
          </Button>
        </SettingRow>
      </SectionCard>
    </div>
  );
}
