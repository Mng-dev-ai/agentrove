import { useDraftField } from '@/hooks/useDraftField';
import { Button } from '@/components/ui/primitives/Button';
import { Select } from '@/components/ui/primitives/Select';
import { Switch } from '@/components/ui/primitives/Switch';
import type { ApiFieldKey, GeneralSecretFieldConfig } from '@/types/settings.types';
import type { UserSettings } from '@/types/user.types';
import type { Theme } from '@/types/ui.types';
import { useUIStore } from '@/store/uiStore';
import { SecretInput } from '@/components/settings/inputs/SecretInput';
import { THEMES } from '@/utils/theme';
import { cn } from '@/utils/cn';

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
    <div className={cn('rounded-xl border border-border p-5 dark:border-border-dark', className)}>
      <h2 className="mb-4 text-xs font-medium text-text-tertiary dark:text-text-dark-tertiary">
        {title}
      </h2>
      {children}
    </div>
  );
}

// Dropdown rather than a row of buttons — 9 themes is too many to lay out inline.
// Width is bounded on the wrapper since Select itself is w-full.
function ThemeControl() {
  const theme = useUIStore((state) => state.theme);
  return (
    <div className="w-48 shrink-0">
      <Select
        value={theme}
        onChange={(e) => useUIStore.getState().setTheme(e.target.value as Theme)}
        className="h-8 text-xs"
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
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium text-text-primary dark:text-text-dark-primary">
            {field.label}
          </h3>
          <p className="mt-0.5 text-xs text-text-tertiary dark:text-text-dark-tertiary">
            {field.description}
          </p>
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

export const GeneralSettingsTab: React.FC<GeneralSettingsTabProps> = ({
  fields,
  settings,
  revealedFields,
  onPersistSecret,
  onToggleVisibility,
  onDeleteAllChats,
  onNotificationsEnabledChange,
}) => (
  <div className="space-y-4">
    <SectionCard title="API Keys & Authentication">
      <div className="space-y-4">
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
      <div className="divide-y divide-border dark:divide-border-dark">
        <div className="flex items-center justify-between gap-4 py-3 first:pt-0">
          <h3 className="text-sm font-medium text-text-primary dark:text-text-dark-primary">
            Theme
          </h3>
          <ThemeControl />
        </div>
        <div className="flex items-start justify-between gap-4 py-3 sm:items-center">
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-medium text-text-primary dark:text-text-dark-primary">
              Notifications
            </h3>
            <p className="mt-0.5 text-xs text-text-tertiary dark:text-text-dark-tertiary">
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
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-medium text-text-primary dark:text-text-dark-primary">
            Delete All Chats
          </h3>
          <p className="mt-0.5 text-xs text-text-tertiary dark:text-text-dark-tertiary">
            Permanently delete all chat history. This action cannot be undone.
          </p>
        </div>
        <Button
          type="button"
          onClick={onDeleteAllChats}
          variant="outline"
          size="sm"
          className="w-full sm:w-auto"
        >
          Delete All
        </Button>
      </div>
    </SectionCard>
  </div>
);
