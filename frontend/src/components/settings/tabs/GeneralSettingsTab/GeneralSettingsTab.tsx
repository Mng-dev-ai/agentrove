import { useDraftField } from '@/hooks/useDraftField';
import clsx from 'clsx';
import { Button } from '@/components/ui/primitives/Button/Button';
import { Select } from '@/components/ui/primitives/Select/Select';
import { Switch } from '@/components/ui/primitives/Switch/Switch';
import type { ApiFieldKey, GeneralSecretFieldConfig } from '@/types/settings.types';
import type { UserSettings } from '@/types/user.types';
import type { Theme } from '@/types/ui.types';
import { useUIStore } from '@/store/uiStore';
import { SecretInput } from '@/components/settings/inputs/SecretInput/SecretInput';
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
}

function SectionCard({
  title,
  children,
  className,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={clsx(styles['section-card'], className)}>
      <h2 className={styles['section-title']}>{title}</h2>
      {children}
    </div>
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
    <div>
      <div className={styles['field-header']}>
        <div>
          <h3 className={styles['setting-title']}>{field.label}</h3>
          <p className={styles['field-desc']}>{field.description}</p>
        </div>
      </div>
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
}: GeneralSettingsTabProps) {
  return (
    <div className={styles.general}>
      <SectionCard title="API Keys & Authentication">
        <div className={styles.stack}>
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
        </div>
      </SectionCard>

      <SectionCard title="Preferences">
        <div className={styles.divided}>
          <div className={styles['pref-row']}>
            <h3 className={styles['setting-title']}>Theme</h3>
            <ThemeControl />
          </div>
          <div className={styles['pref-row-notif']}>
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
        </div>
      </SectionCard>

      <SectionCard title="Data Management">
        <div className={styles['data-row']}>
          <div className={styles['pref-text']}>
            <h3 className={styles['setting-title']}>Delete All Chats</h3>
            <p className={styles['field-desc']}>
              Permanently delete all chat history. This action cannot be undone.
            </p>
          </div>
          <Button
            type="button"
            onClick={onDeleteAllChats}
            variant="outline"
            size="sm"
            className={styles['delete-button']}
          >
            Delete All
          </Button>
        </div>
      </SectionCard>
    </div>
  );
}
