import { useState, useEffect } from 'react';
import { Button, Input, Label, Switch, Select } from '@/components/ui';
import { BaseModal } from '@/components/ui/shared/BaseModal';
import { SecretInput } from '../inputs/SecretInput';
import { CodexAuthUpload } from '../inputs/CodexAuthUpload';
import { ModelListEditor } from '../inputs/ModelListEditor';
import type {
  CustomProvider,
  CustomProviderModel,
  ProviderType,
  HelperTextCode,
  HelperTextLink,
} from '@/types';

interface ProviderDialogProps {
  isOpen: boolean;
  provider: CustomProvider | null;
  error?: string | null;
  onClose: () => void;
  onSave: (provider: CustomProvider) => void;
}

const DEFAULT_ANTHROPIC_PROVIDER: Omit<CustomProvider, 'id' | 'auth_token'> = {
  name: 'Anthropic',
  provider_type: 'anthropic',
  enabled: true,
  models: [
    { model_id: 'claude-opus-4-5', name: 'Claude Opus 4.5', enabled: true },
    { model_id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5', enabled: true },
    { model_id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', enabled: true },
  ],
};

const DEFAULT_OPENROUTER_PROVIDER: Omit<CustomProvider, 'id' | 'auth_token'> = {
  name: 'OpenRouter',
  provider_type: 'openrouter',
  enabled: true,
  models: [
    { model_id: 'openrouter/openai/gpt-5.2', name: 'GPT-5.2', enabled: true },
    { model_id: 'openrouter/openai/gpt-5.1-codex', name: 'GPT-5.1 Codex', enabled: true },
    { model_id: 'openrouter/x-ai/grok-code-fast-1', name: 'Grok Code Fast', enabled: true },
    { model_id: 'openrouter/moonshotai/kimi-k2-thinking', name: 'Kimi K2 Thinking', enabled: true },
    { model_id: 'openrouter/minimax/minimax-m2', name: 'Minimax M2', enabled: true },
    { model_id: 'openrouter/deepseek/deepseek-v3.2', name: 'Deepseek V3.2', enabled: true },
  ],
};

const DEFAULT_OPENAI_PROVIDER: Omit<CustomProvider, 'id' | 'auth_token'> = {
  name: 'OpenAI',
  provider_type: 'openai',
  enabled: true,
  models: [
    { model_id: 'openai/gpt-5.2-codex', name: 'GPT-5.2 Codex', enabled: true },
    { model_id: 'openai/gpt-5.2', name: 'GPT-5.2', enabled: true },
  ],
};

const PROVIDER_TYPE_OPTIONS = [
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'openrouter', label: 'OpenRouter' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'custom', label: 'Custom' },
];

const createEmptyProvider = (): CustomProvider => ({
  id: crypto.randomUUID(),
  name: '',
  provider_type: 'custom',
  base_url: '',
  auth_token: '',
  enabled: true,
  models: [],
});

const createProviderFromType = (providerType: ProviderType): CustomProvider => {
  const id = crypto.randomUUID();
  switch (providerType) {
    case 'anthropic':
      return { ...DEFAULT_ANTHROPIC_PROVIDER, id, auth_token: '' };
    case 'openrouter':
      return { ...DEFAULT_OPENROUTER_PROVIDER, id, auth_token: '' };
    case 'openai':
      return { ...DEFAULT_OPENAI_PROVIDER, id, auth_token: '' };
    default:
      return createEmptyProvider();
  }
};

const getAuthTokenConfig = (
  providerType: ProviderType,
): {
  label: string;
  placeholder: string;
  helperText?: HelperTextCode | HelperTextLink;
} => {
  switch (providerType) {
    case 'anthropic':
      return {
        label: 'OAuth Token',
        placeholder: 'Paste token from claude setup-token',
        helperText: {
          prefix: 'Requires Claude Max ($100-200/mo). Run',
          code: 'claude setup-token',
          suffix: 'in terminal',
        },
      };
    case 'openrouter':
      return {
        label: 'API Key',
        placeholder: 'Enter your OpenRouter API key',
        helperText: {
          prefix: 'Get your API key from',
          anchorText: 'openrouter.ai',
          href: 'https://openrouter.ai/keys',
        },
      };
    case 'openai':
      return {
        label: 'Auth (Optional)',
        placeholder: 'Uses ~/.codex/auth.json from codex login',
        helperText: {
          prefix: 'Run',
          code: 'codex login',
          suffix: 'in terminal to authenticate with ChatGPT',
        },
      };
    case 'custom':
    default:
      return {
        label: 'API Key',
        placeholder: 'Enter API key (if required)',
        helperText: {
          prefix: 'API key for authentication (if required)',
          code: '',
          suffix: '',
        },
      };
  }
};

export const ProviderDialog: React.FC<ProviderDialogProps> = ({
  isOpen,
  provider,
  error,
  onClose,
  onSave,
}) => {
  const [form, setForm] = useState<CustomProvider>(createEmptyProvider());
  const [showToken, setShowToken] = useState(false);
  const [selectedProviderType, setSelectedProviderType] = useState<ProviderType>('anthropic');
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      if (provider) {
        setForm({ ...provider });
        setSelectedProviderType(provider.provider_type);
      } else {
        setSelectedProviderType('anthropic');
        setForm(createProviderFromType('anthropic'));
      }
      setLocalError(null);
      setShowToken(false);
    }
  }, [isOpen, provider]);

  const handleProviderTypeChange = (providerType: ProviderType) => {
    setSelectedProviderType(providerType);
    const currentToken = form.auth_token;
    const newProviderForm = createProviderFromType(providerType);
    setForm({ ...newProviderForm, auth_token: currentToken });
    setLocalError(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (form.provider_type === 'openai' && !form.auth_token) {
      setLocalError('auth.json is required for OpenAI providers. Run "codex login" first.');
      return;
    }
    onSave(form);
  };

  const handleModelsChange = (models: CustomProviderModel[]) => {
    setForm((prev) => ({ ...prev, models }));
  };

  const isEditing = provider !== null;
  const isBuiltIn =
    form.provider_type === 'anthropic' ||
    form.provider_type === 'openrouter' ||
    form.provider_type === 'openai';
  const showBaseUrl = !isBuiltIn;
  const authConfig = getAuthTokenConfig(form.provider_type);
  const errorMessage = localError ?? error;

  const getDialogTitle = () => {
    if (isEditing) return 'Edit Provider';
    switch (selectedProviderType) {
      case 'anthropic':
        return 'Add Anthropic Provider';
      case 'openrouter':
        return 'Add OpenRouter Provider';
      case 'openai':
        return 'Add OpenAI Provider';
      default:
        return 'Add Custom Provider';
    }
  };

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      size="lg"
      className="max-h-[90vh] overflow-y-auto shadow-strong"
    >
      <div className="p-6">
        <h3 className="mb-4 text-lg font-semibold text-text-primary dark:text-text-dark-primary">
          {getDialogTitle()}
        </h3>

        {errorMessage && (
          <div className="mb-4 rounded-md border border-error-200 bg-error-50 p-3 dark:border-error-800 dark:bg-error-900/20">
            <p className="text-xs text-error-700 dark:text-error-400">{errorMessage}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {!isEditing && (
            <div>
              <Label className="mb-1.5 text-sm text-text-primary dark:text-text-dark-primary">
                Provider Type
              </Label>
              <Select
                value={selectedProviderType}
                onChange={(e) => handleProviderTypeChange(e.target.value as ProviderType)}
              >
                {PROVIDER_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
              <p className="mt-1 text-xs text-text-tertiary dark:text-text-dark-tertiary">
                {selectedProviderType === 'custom'
                  ? 'Configure a custom Anthropic-compatible API provider'
                  : selectedProviderType === 'openai'
                    ? 'Use OpenAI models with your ChatGPT subscription'
                    : `Pre-configured with default ${selectedProviderType === 'anthropic' ? 'Claude' : 'OpenRouter'} models`}
              </p>
            </div>
          )}

          <div>
            <Label className="mb-1.5 text-sm text-text-primary dark:text-text-dark-primary">
              Provider Name
            </Label>
            <Input
              value={form.name}
              onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
              placeholder={isEditing ? undefined : 'e.g., DeepSeek, Local Ollama'}
              className="text-sm"
              required
            />
          </div>

          {showBaseUrl && (
            <div>
              <Label className="mb-1.5 text-sm text-text-primary dark:text-text-dark-primary">
                Base URL
              </Label>
              <Input
                value={form.base_url || ''}
                onChange={(e) => setForm((prev) => ({ ...prev, base_url: e.target.value }))}
                placeholder="https://api.example.com/v1"
                className="font-mono text-sm"
                required
              />
              <p className="mt-1 text-xs text-text-tertiary dark:text-text-dark-tertiary">
                The base URL for the Anthropic-compatible API endpoint
              </p>
            </div>
          )}

          {form.provider_type === 'openai' ? (
            <div>
              <Label className="mb-1.5 text-sm text-text-primary dark:text-text-dark-primary">
                Codex Authentication
              </Label>
              <p className="mb-2 text-xs text-text-tertiary dark:text-text-dark-tertiary">
                Upload your auth.json from{' '}
                <code className="rounded bg-surface-tertiary px-1 dark:bg-surface-dark-tertiary">
                  ~/.codex/auth.json
                </code>{' '}
                or run{' '}
                <code className="rounded bg-surface-tertiary px-1 dark:bg-surface-dark-tertiary">
                  codex login
                </code>{' '}
                in terminal. Required for OpenAI providers.
              </p>
              <CodexAuthUpload
                value={form.auth_token || null}
                onChange={(content) => {
                  setForm((prev) => ({ ...prev, auth_token: content || '' }));
                  setLocalError(null);
                }}
              />
            </div>
          ) : (
            <div>
              <Label className="mb-1.5 text-sm text-text-primary dark:text-text-dark-primary">
                {authConfig.label}
              </Label>
              <SecretInput
                value={form.auth_token || ''}
                onChange={(value) => setForm((prev) => ({ ...prev, auth_token: value }))}
                placeholder={authConfig.placeholder}
                isVisible={showToken}
                onToggleVisibility={() => setShowToken(!showToken)}
                helperText={authConfig.helperText}
                containerClassName="w-full"
              />
            </div>
          )}

          <ModelListEditor models={form.models} onChange={handleModelsChange} />

          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm text-text-primary dark:text-text-dark-primary">
                Enable Provider
              </Label>
              <p className="mt-0.5 text-xs text-text-tertiary dark:text-text-dark-tertiary">
                Provider models will only be available when enabled
              </p>
            </div>
            <Switch
              checked={form.enabled ?? true}
              onCheckedChange={(checked) => setForm((prev) => ({ ...prev, enabled: checked }))}
              size="sm"
              aria-label="Enable provider"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" onClick={onClose} variant="outline" size="sm">
              Cancel
            </Button>
            <Button type="submit" variant="primary" size="sm">
              {isEditing ? 'Save Changes' : 'Add Provider'}
            </Button>
          </div>
        </form>
      </div>
    </BaseModal>
  );
};
