import { Button, Switch } from '@/components/ui';
import type {
  UserSettings,
  GeneralSecretFieldConfig,
  ApiFieldKey,
  SandboxProviderType,
} from '@/types';
import { SecretInput } from '@/components/settings/inputs/SecretInput';

interface GeneralSettingsTabProps {
  fields: GeneralSecretFieldConfig[];
  settings: UserSettings;
  savedSettings: UserSettings | undefined;
  revealedFields: Record<ApiFieldKey, boolean>;
  onSecretChange: (field: ApiFieldKey, value: string) => void;
  onToggleVisibility: (field: ApiFieldKey) => void;
  onDeleteAllChats: () => void;
  onNotificationSoundChange: (enabled: boolean) => void;
  onAutoCompactDisabledChange: (disabled: boolean) => void;
  onAttributionDisabledChange: (disabled: boolean) => void;
  onSandboxProviderChange: (provider: SandboxProviderType) => void;
}

export const GeneralSettingsTab: React.FC<GeneralSettingsTabProps> = ({
  fields,
  settings,
  savedSettings,
  revealedFields,
  onSecretChange,
  onToggleVisibility,
  onDeleteAllChats,
  onNotificationSoundChange,
  onAutoCompactDisabledChange,
  onAttributionDisabledChange,
  onSandboxProviderChange,
}) => (
  <div className="space-y-6">
    <div>
      <h2 className="mb-4 text-sm font-medium text-text-primary dark:text-text-dark-primary">
        API Keys & Authentication
      </h2>
      <div className="space-y-4">
        {fields.map((field) => (
          <div key={field.key}>
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
              value={settings[field.key] ?? ''}
              placeholder={field.placeholder}
              isVisible={revealedFields[field.key]}
              onChange={(value) => onSecretChange(field.key, value)}
              onToggleVisibility={() => onToggleVisibility(field.key)}
              helperText={field.helperText}
            />
          </div>
        ))}
      </div>
    </div>

    <div>
      <h2 className="mb-4 text-sm font-medium text-text-primary dark:text-text-dark-primary">
        Sandbox Provider
      </h2>
      <div className="space-y-4">
        <div>
          <p className="mb-2 text-xs text-text-tertiary dark:text-text-dark-tertiary">
            Select the sandbox environment for code execution. E2B and Modal require API keys.
          </p>
          <div className="flex gap-4">
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="radio"
                name="sandbox_provider"
                value="docker"
                checked={settings.sandbox_provider === 'docker'}
                onChange={() => onSandboxProviderChange('docker')}
                className="border-border-light text-accent-primary focus:ring-accent-primary h-4 w-4 dark:border-border-dark"
              />
              <span className="text-sm text-text-primary dark:text-text-dark-primary">
                Docker (Local)
              </span>
            </label>
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="radio"
                name="sandbox_provider"
                value="e2b"
                checked={settings.sandbox_provider === 'e2b'}
                onChange={() => onSandboxProviderChange('e2b')}
                disabled={!savedSettings?.e2b_api_key}
                className="border-border-light text-accent-primary focus:ring-accent-primary h-4 w-4 disabled:cursor-not-allowed disabled:opacity-50 dark:border-border-dark"
              />
              <span
                className={`text-sm ${savedSettings?.e2b_api_key ? 'text-text-primary dark:text-text-dark-primary' : 'text-text-tertiary dark:text-text-dark-tertiary'}`}
              >
                E2B (Cloud)
              </span>
            </label>
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="radio"
                name="sandbox_provider"
                value="modal"
                checked={settings.sandbox_provider === 'modal'}
                onChange={() => onSandboxProviderChange('modal')}
                disabled={!savedSettings?.modal_api_key}
                className="border-border-light text-accent-primary focus:ring-accent-primary h-4 w-4 disabled:cursor-not-allowed disabled:opacity-50 dark:border-border-dark"
              />
              <span
                className={`text-sm ${savedSettings?.modal_api_key ? 'text-text-primary dark:text-text-dark-primary' : 'text-text-tertiary dark:text-text-dark-tertiary'}`}
              >
                Modal (Cloud)
              </span>
            </label>
          </div>
        </div>
      </div>
    </div>

    <div>
      <h2 className="mb-4 text-sm font-medium text-text-primary dark:text-text-dark-primary">
        Notifications
      </h2>
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-4 sm:items-center">
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-medium text-text-primary dark:text-text-dark-primary">
              Sound Notification
            </h3>
            <p className="mt-0.5 text-xs text-text-tertiary dark:text-text-dark-tertiary">
              Play a sound when the assistant finishes responding.
            </p>
          </div>
          <Switch
            checked={settings.notification_sound_enabled ?? true}
            onCheckedChange={onNotificationSoundChange}
          />
        </div>
      </div>
    </div>

    <div>
      <h2 className="mb-4 text-sm font-medium text-text-primary dark:text-text-dark-primary">
        Claude Settings
      </h2>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-medium text-text-primary dark:text-text-dark-primary">
              Disable Auto Compact
            </h3>
            <p className="mt-0.5 text-xs text-text-tertiary dark:text-text-dark-tertiary">
              Prevents Claude from automatically compacting conversation history.
            </p>
          </div>
          <Switch
            checked={settings.auto_compact_disabled ?? false}
            onCheckedChange={onAutoCompactDisabledChange}
          />
        </div>
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-medium text-text-primary dark:text-text-dark-primary">
              Disable Attribution
            </h3>
            <p className="mt-0.5 text-xs text-text-tertiary dark:text-text-dark-tertiary">
              Removes Claude attribution from commits and pull requests.
            </p>
          </div>
          <Switch
            checked={settings.attribution_disabled ?? false}
            onCheckedChange={onAttributionDisabledChange}
          />
        </div>
      </div>
    </div>

    <div>
      <h2 className="mb-4 text-sm font-medium text-text-primary dark:text-text-dark-primary">
        Data Management
      </h2>
      <div className="space-y-4">
        <div>
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
              className="w-full border-error-200 text-error-600 hover:bg-error-50 dark:border-error-800 dark:text-error-400 dark:hover:bg-error-400/20 sm:w-auto"
            >
              Delete All
            </Button>
          </div>
        </div>
      </div>
    </div>
  </div>
);
