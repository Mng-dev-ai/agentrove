import { useDraftField } from '@/hooks/useDraftField';
import { Button } from '@/components/ui/primitives/Button/Button';
import { Select } from '@/components/ui/primitives/Select/Select';
import { Switch } from '@/components/ui/primitives/Switch/Switch';
import type { ApiFieldKey, GeneralSecretFieldConfig } from '@/types/settings.types';
import type { UserSettings } from '@/types/user.types';
import type { Theme } from '@/types/ui.types';
import { useUIStore } from '@/store/uiStore';
import { SecretInput } from '@/components/settings/inputs/SecretInput/SecretInput';
import { ModelSelector } from '@/components/chat/model-selector/ModelSelector';
import { THEMES } from '@/utils/theme';
import styles from './GeneralSettingsTab.module.scss';

interface GeneralSettingsTabProps {
  fields: GeneralSecretFieldConfig[];
  settings: UserSettings;
  revealedFields: Record<ApiFieldKey, boolean>;
  onPersistSecret: (field: ApiFieldKey, value: string) => void;
  onToggleVisibility: (field: ApiFieldKey) => void;
  onDeleteAllChats: () => void;
  onNotificationsEnabledChange: (enabled: boolean) => void;
  onAutoSteerQueuedMessagesChange: (enabled: boolean) => void;
  onTitleModelChange: (modelId: string) => void;
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className={styles['section-title']}>{title}</h2>
      <div className={styles['section-card']}>{children}</div>
    </section>
  );
}

// Dropdown rather than a row of buttons — 9 themes is too many to lay out inline.
// Width is bounded on the wrapper since Select itself is w-full.
function ThemeControl() {
  const theme = useUIStore((state) => state.theme);
  return (
    <div className={styles['theme-control']}>
      <Select
        value={theme}
        onChange={(e) => useUIStore.getState().setTheme(e.target.value as Theme)}
        className={styles['theme-select']}
        aria-label="Theme"
      >
        {THEMES.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </Select>
    </div>
  );
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
  onNotificationsEnabledChange,
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
        <div className={styles['pref-row']}>
          <h3 className={styles['setting-title']}>Theme</h3>
          <ThemeControl />
        </div>
        <div className={styles['pref-row']}>
          <div className={styles['pref-text']}>
            <h3 className={styles['setting-title']}>Notifications</h3>
            <p className={styles['field-desc']}>
              Send notifications for permission requests, questions, and task completion.
            </p>
          </div>
          <Switch
            checked={settings.notifications_enabled}
            onCheckedChange={onNotificationsEnabledChange}
            aria-label="Notifications"
          />
        </div>
        <div className={styles['pref-row']}>
          <div className={styles['pref-text']}>
            <h3 className={styles['setting-title']}>Auto-steer queued messages</h3>
            <p className={styles['field-desc']}>
              Send messages typed while agents are working immediately instead of queuing them until
              they finish.
            </p>
          </div>
          <Switch
            checked={settings.auto_steer_queued_messages}
            onCheckedChange={onAutoSteerQueuedMessagesChange}
            aria-label="Auto-steer queued messages"
          />
        </div>
        <div className={styles['pref-row']}>
          <div className={styles['pref-text']}>
            <h3 className={styles['setting-title']}>Title Generation Model</h3>
            <p className={styles['field-desc']}>Model used to generate chat titles.</p>
          </div>
          <ModelSelector
            selectedModelId={settings.title_model_id}
            onModelChange={onTitleModelChange}
            compact={false}
            dropdownAlign="right"
          />
        </div>
      </SectionCard>

      <SectionCard title="Data Management">
        <div className={styles['pref-row']}>
          <div className={styles['pref-text']}>
            <h3 className={styles['setting-title']}>Delete All Chats</h3>
            <p className={styles['field-desc']}>
              Permanently delete all chat history. This action cannot be undone.
            </p>
          </div>
          <Button type="button" onClick={onDeleteAllChats} variant="outline" size="sm">
            Delete All
          </Button>
        </div>
      </SectionCard>
    </div>
  );
}
