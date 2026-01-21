import { useState } from 'react';
import { Plus, Pencil, Trash2, ChevronDown, ChevronRight, Check, X } from 'lucide-react';
import { Button, Switch, ConfirmDialog } from '@/components/ui';
import type { CustomProvider, ProviderType } from '@/types';

interface ProvidersSettingsTabProps {
  providers: CustomProvider[] | null;
  onAddProvider: () => void;
  onEditProvider: (provider: CustomProvider) => void;
  onDeleteProvider: (providerId: string) => void;
  onToggleProvider: (providerId: string, enabled: boolean) => void;
}

const PROVIDER_TYPE_LABELS: Record<ProviderType, string> = {
  anthropic: 'Anthropic',
  openrouter: 'OpenRouter',
  openai: 'OpenAI',
  custom: 'Custom',
};

const PROVIDER_TYPE_COLORS: Record<ProviderType, string> = {
  anthropic: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  openrouter: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
  openai: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  custom: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400',
};

export const ProvidersSettingsTab: React.FC<ProvidersSettingsTabProps> = ({
  providers,
  onAddProvider,
  onEditProvider,
  onDeleteProvider,
  onToggleProvider,
}) => {
  const [expandedProviders, setExpandedProviders] = useState<Set<string>>(new Set());
  const [providerPendingDelete, setProviderPendingDelete] = useState<CustomProvider | null>(null);

  const toggleExpanded = (providerId: string) => {
    setExpandedProviders((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(providerId)) {
        newSet.delete(providerId);
      } else {
        newSet.add(providerId);
      }
      return newSet;
    });
  };

  const sortedProviders = [...(providers ?? [])].sort((a, b) => {
    const order: Record<ProviderType, number> = {
      anthropic: 0,
      openrouter: 1,
      openai: 2,
      custom: 3,
    };
    return order[a.provider_type] - order[b.provider_type];
  });

  const handleConfirmDelete = () => {
    if (providerPendingDelete) {
      onDeleteProvider(providerPendingDelete.id);
      setProviderPendingDelete(null);
    }
  };

  if (!providers || providers.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="mb-4 text-sm font-medium text-text-primary dark:text-text-dark-primary">
            AI Providers
          </h2>
          <p className="mb-4 text-xs text-text-tertiary dark:text-text-dark-tertiary">
            Configure AI providers for model access. Add providers like Anthropic, OpenRouter, or
            custom endpoints.
          </p>
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-12 dark:border-border-dark">
            <p className="mb-4 text-sm text-text-tertiary dark:text-text-dark-tertiary">
              No providers configured
            </p>
            <Button onClick={onAddProvider} variant="primary" size="sm">
              <Plus className="h-4 w-4" />
              Add Provider
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-medium text-text-primary dark:text-text-dark-primary">
              AI Providers
            </h2>
            <p className="mt-1 text-xs text-text-tertiary dark:text-text-dark-tertiary">
              Configure AI providers for model access
            </p>
          </div>
          <Button onClick={onAddProvider} variant="outline" size="sm">
            <Plus className="h-4 w-4" />
            Add Provider
          </Button>
        </div>

        <div className="space-y-3">
          {sortedProviders.map((provider) => {
            const isExpanded = expandedProviders.has(provider.id);
            const enabledModels = provider.models.filter((m) => m.enabled);

            return (
              <div
                key={provider.id}
                className="bg-surface-primary dark:bg-surface-dark-primary rounded-lg border border-border dark:border-border-dark"
              >
                <div className="flex items-center gap-3 p-4">
                  <button
                    type="button"
                    onClick={() => toggleExpanded(provider.id)}
                    className="flex-shrink-0 text-text-tertiary hover:text-text-primary dark:text-text-dark-tertiary dark:hover:text-text-dark-primary"
                  >
                    {isExpanded ? (
                      <ChevronDown className="h-4 w-4" />
                    ) : (
                      <ChevronRight className="h-4 w-4" />
                    )}
                  </button>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-medium text-text-primary dark:text-text-dark-primary">
                        {provider.name}
                      </h3>
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${PROVIDER_TYPE_COLORS[provider.provider_type]}`}
                      >
                        {PROVIDER_TYPE_LABELS[provider.provider_type]}
                      </span>
                      {provider.auth_token ? (
                        <span className="inline-flex items-center gap-1 text-xs text-success-600 dark:text-success-500">
                          <Check className="h-3 w-3" />
                          Configured
                        </span>
                      ) : provider.provider_type === 'openai' ? (
                        <span className="inline-flex items-center gap-1 text-xs text-text-tertiary dark:text-text-dark-tertiary">
                          Uses ~/.codex/auth.json
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs text-warning-600 dark:text-warning-500">
                          <X className="h-3 w-3" />
                          No API key
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-text-tertiary dark:text-text-dark-tertiary">
                      {enabledModels.length} model{enabledModels.length !== 1 ? 's' : ''} •{' '}
                      {provider.provider_type === 'custom' && provider.base_url
                        ? provider.base_url.replace(/^https?:\/\//, '').split('/')[0]
                        : provider.provider_type === 'anthropic'
                          ? 'api.anthropic.com'
                          : provider.provider_type === 'openai'
                            ? 'ChatGPT API'
                            : 'openrouter.ai'}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <Switch
                      checked={provider.enabled}
                      onCheckedChange={(checked) => onToggleProvider(provider.id, checked)}
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onEditProvider(provider)}
                      className="h-8 w-8 p-0"
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setProviderPendingDelete(provider)}
                      className="h-8 w-8 p-0 text-error-600 hover:bg-error-50 hover:text-error-700 dark:text-error-400 dark:hover:bg-error-900/20"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                {isExpanded && provider.models.length > 0 && (
                  <div className="border-t border-border px-4 py-3 dark:border-border-dark">
                    <h4 className="mb-2 text-xs font-medium text-text-secondary dark:text-text-dark-secondary">
                      Models
                    </h4>
                    <div className="space-y-1">
                      {provider.models.map((model) => (
                        <div
                          key={model.model_id}
                          className="flex items-center justify-between rounded px-2 py-1.5 text-xs"
                        >
                          <div>
                            <span className="font-medium text-text-primary dark:text-text-dark-primary">
                              {model.name}
                            </span>
                            <span className="ml-2 text-text-tertiary dark:text-text-dark-tertiary">
                              {model.model_id}
                            </span>
                          </div>
                          <span
                            className={
                              model.enabled
                                ? 'text-success-600 dark:text-success-500'
                                : 'text-text-tertiary dark:text-text-dark-tertiary'
                            }
                          >
                            {model.enabled ? 'Enabled' : 'Disabled'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {isExpanded && provider.models.length === 0 && (
                  <div className="border-t border-border px-4 py-3 dark:border-border-dark">
                    <p className="text-xs text-text-tertiary dark:text-text-dark-tertiary">
                      No models configured. Edit this provider to add models.
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <ConfirmDialog
        isOpen={providerPendingDelete !== null}
        onClose={() => setProviderPendingDelete(null)}
        onConfirm={handleConfirmDelete}
        title="Delete Provider"
        message={`Are you sure you want to delete "${providerPendingDelete?.name}"? This action cannot be undone.`}
        confirmLabel="Delete"
        cancelLabel="Cancel"
      />
    </div>
  );
};
