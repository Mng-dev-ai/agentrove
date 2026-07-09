import { memo, useState, useEffect, useCallback, useRef } from 'react';
import { logger } from '@/utils/logger';
import { Plus, Trash2, EyeOff, Eye, AlertTriangle } from 'lucide-react';
import {
  useSecretsQuery,
  useAddSecretMutation,
  useUpdateSecretMutation,
  useDeleteSecretMutation,
} from '@/hooks/queries/useSandboxQueries';
import { Button } from '@/components/ui/primitives/Button/Button';
import { Input } from '@/components/ui/primitives/Input/Input';
import { Spinner } from '@/components/ui/primitives/Spinner/Spinner';
import { RefreshButton } from '@/components/ui/shared/RefreshButton/RefreshButton';
import { SaveButton } from '@/components/ui/shared/SaveButton/SaveButton';
import type { Secret } from '@/types/sandbox.types';
import toast from 'react-hot-toast';
import { cn } from '@/utils/cn';

export interface SecretsViewProps {
  sandboxId?: string;
}

function enrichSecrets(data: Secret[]): Secret[] {
  return data.map((secret) => ({
    ...secret,
    originalKey: secret.key,
    originalValue: secret.value,
    isNew: false,
    isModified: false,
    isDeleted: false,
  }));
}

export const SecretsView = memo(function SecretsView({ sandboxId }: SecretsViewProps) {
  const [secrets, setSecrets] = useState<Secret[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [showValues, setShowValues] = useState<Record<string, boolean>>({});

  const { data: secretsData, isLoading, refetch: refetchSecrets } = useSecretsQuery(sandboxId);
  const addSecretMutation = useAddSecretMutation();
  const updateSecretMutation = useUpdateSecretMutation();
  const deleteSecretMutation = useDeleteSecretMutation();

  // Swapping the secondary chat changes the sandbox on this same instance — drop
  // the prior sandbox's secrets (and reveal toggles) so a cached fetch can't flash
  // another chat's values before the new data arrives.
  const prevSandboxIdRef = useRef(sandboxId);
  if (prevSandboxIdRef.current !== sandboxId) {
    prevSandboxIdRef.current = sandboxId;
    setSecrets([]);
    setShowValues({});
  }

  useEffect(() => {
    if (secretsData) {
      setSecrets(enrichSecrets(secretsData));
    }
  }, [secretsData]);

  const hasChanges = secrets.some(
    (secret) => secret.isNew || secret.isModified || secret.isDeleted,
  );

  const hasEmptyKeys = secrets.some((secret) => !secret.isDeleted && secret.key.trim() === '');

  const loadEnvironmentVariables = useCallback(() => {
    refetchSecrets();
  }, [refetchSecrets]);

  const handleAddSecret = () => {
    if (hasEmptyKeys) {
      toast.error('Please fill in all empty keys before adding a new variable');
      return;
    }

    setSecrets((current) => [...current, { key: '', value: '', isNew: true }]);
  };

  const handleRemoveSecret = async (index: number) => {
    const targetSecret = secrets[index];

    if (!targetSecret) {
      return;
    }

    if (targetSecret.isNew) {
      setSecrets((current) => current.filter((_, itemIndex) => itemIndex !== index));
      return;
    }

    if (!sandboxId || !targetSecret.originalKey) {
      return;
    }

    try {
      await deleteSecretMutation.mutateAsync({ sandboxId, key: targetSecret.originalKey });
      setSecrets((current) =>
        current.filter((secret) => secret.originalKey !== targetSecret.originalKey),
      );
      toast.success('Environment variable deleted successfully');
    } catch (error) {
      logger.error('Environment variable delete failed', 'SecretsView', error);
      toast.error('Failed to delete environment variable');
    }
  };

  const handleUpdateSecret = (index: number, field: 'key' | 'value', value: string) => {
    setSecrets((currentSecrets) => {
      if (index < 0 || index >= currentSecrets.length) {
        return currentSecrets;
      }

      const existingSecret = currentSecrets[index];
      const updatedSecret = { ...existingSecret, [field]: value };

      if (!existingSecret.isNew && !existingSecret.isDeleted) {
        const updatedKey = field === 'key' ? value : updatedSecret.key;
        const updatedValue = field === 'value' ? value : updatedSecret.value;
        const keyChanged = updatedKey !== existingSecret.originalKey;
        const valueChanged = updatedValue !== existingSecret.originalValue;
        updatedSecret.isModified = keyChanged || valueChanged;
      }

      const nextSecrets = [...currentSecrets];
      nextSecrets[index] = updatedSecret;
      return nextSecrets;
    });
  };

  const toggleShowValue = (index: number) => {
    setShowValues((current) => ({
      ...current,
      [index]: !current[index],
    }));
  };

  const handleSaveSecrets = async () => {
    if (!sandboxId) {
      toast.error('No sandbox available');
      return;
    }

    setIsSaving(true);

    try {
      const activeSecrets = secrets.filter(
        (secret) => !secret.isDeleted && secret.key.trim() !== '',
      );

      if (activeSecrets.length === 0) {
        setIsSaving(false);
        return;
      }

      for (const secret of activeSecrets) {
        if (secret.isNew) {
          await addSecretMutation.mutateAsync({ sandboxId, key: secret.key, value: secret.value });
        } else if (secret.isModified && secret.originalKey) {
          if (secret.key !== secret.originalKey) {
            await deleteSecretMutation.mutateAsync({ sandboxId, key: secret.originalKey });
            await addSecretMutation.mutateAsync({
              sandboxId,
              key: secret.key,
              value: secret.value,
            });
          } else {
            await updateSecretMutation.mutateAsync({
              sandboxId,
              key: secret.originalKey,
              value: secret.value,
            });
          }
        }
      }

      toast.success('Environment variables saved successfully');
    } catch (error) {
      logger.error('Environment variables save failed', 'SecretsView', error);
      toast.error('Failed to save environment variables');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="flex h-full w-full flex-col bg-surface-secondary dark:bg-surface-dark-secondary">
      <div className="flex h-9 items-center justify-between border-b border-border/50 px-3 dark:border-border-dark/50">
        <span className="text-2xs font-medium uppercase tracking-wider text-text-quaternary dark:text-text-dark-quaternary">
          Environment Variables
        </span>
        <div className="flex items-center gap-1">
          <RefreshButton
            onClick={loadEnvironmentVariables}
            disabled={!sandboxId}
            isRefreshing={isLoading}
            ariaLabel="Refresh secrets"
          />
          {hasChanges && (
            <SaveButton
              onClick={handleSaveSecrets}
              isSaving={isSaving}
              disabled={isSaving || !sandboxId}
            />
          )}
        </div>
      </div>

      {!sandboxId && (
        <div className="mx-3 mt-3 flex items-center gap-2 rounded-lg border border-warning-200 bg-warning-50/50 p-2.5 text-2xs text-warning-600 dark:border-warning-800/50 dark:bg-warning-500/5 dark:text-warning-400">
          <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
          <p>No sandbox connected. Start a chat to manage environment variables.</p>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-3 py-2">
        {isLoading && (
          <div className="flex h-40 items-center justify-center">
            <Spinner size="md" className="text-text-quaternary dark:text-text-dark-quaternary" />
          </div>
        )}

        {!isLoading && secrets.length === 0 ? (
          <div className="flex h-40 flex-col items-center justify-center gap-3">
            <p className="text-xs text-text-quaternary dark:text-text-dark-quaternary">
              No variables yet
            </p>
            <Button
              onClick={handleAddSecret}
              disabled={!sandboxId}
              variant="unstyled"
              className="flex items-center gap-1 rounded-md px-2 py-1 text-2xs text-text-tertiary transition-colors duration-200 hover:bg-surface-hover hover:text-text-secondary disabled:opacity-50 dark:text-text-dark-tertiary dark:hover:bg-surface-dark-hover dark:hover:text-text-dark-secondary"
            >
              <Plus className="h-3 w-3" />
              Add Variable
            </Button>
          </div>
        ) : (
          !isLoading && (
            <div className="space-y-1.5">
              {secrets.map(
                (secret, index) =>
                  !secret.isDeleted && (
                    <div
                      key={secret.originalKey ?? `new-${index}`}
                      className={cn(
                        'flex items-center gap-1.5 rounded-lg border p-2 transition-colors duration-200',
                        secret.isNew
                          ? 'border-border-hover/50 dark:border-border-dark-hover/50'
                          : secret.isModified
                            ? 'border-border-hover/50 dark:border-border-dark-hover/50'
                            : 'border-border/30 dark:border-border-dark/30',
                      )}
                    >
                      <div className="grid flex-1 grid-cols-2 gap-1.5">
                        <Input
                          type="text"
                          value={secret.key}
                          onChange={(e) => handleUpdateSecret(index, 'key', e.target.value)}
                          placeholder="KEY"
                          aria-label="Secret key"
                          className="w-full rounded-md border border-border/30 bg-transparent px-2 py-1 font-mono text-2xs text-text-primary focus:border-border-hover focus:outline-none dark:border-border-dark/30 dark:text-text-dark-primary dark:focus:border-border-dark-hover"
                          variant="unstyled"
                        />
                        <div className="relative">
                          <Input
                            type={showValues[index] ? 'text' : 'password'}
                            value={secret.value}
                            onChange={(e) => handleUpdateSecret(index, 'value', e.target.value)}
                            placeholder="VALUE"
                            aria-label="Secret value"
                            className="w-full rounded-md border border-border/30 bg-transparent px-2 py-1 pr-7 font-mono text-2xs text-text-primary focus:border-border-hover focus:outline-none dark:border-border-dark/30 dark:text-text-dark-primary dark:focus:border-border-dark-hover"
                            variant="unstyled"
                          />
                          <Button
                            onClick={() => toggleShowValue(index)}
                            variant="unstyled"
                            aria-label={showValues[index] ? 'Hide secret' : 'Show secret'}
                            className="absolute right-1.5 top-1/2 -translate-y-1/2 text-text-quaternary transition-colors duration-200 hover:text-text-secondary dark:hover:text-text-dark-secondary"
                          >
                            {showValues[index] ? (
                              <EyeOff className="h-3 w-3" />
                            ) : (
                              <Eye className="h-3 w-3" />
                            )}
                          </Button>
                        </div>
                      </div>
                      <Button
                        onClick={() => handleRemoveSecret(index)}
                        variant="unstyled"
                        aria-label="Delete secret"
                        className="rounded-md p-1 text-text-quaternary transition-colors duration-200 hover:text-error-600 dark:hover:text-error-400"
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  ),
              )}

              <div className="pt-1">
                <Button
                  onClick={handleAddSecret}
                  disabled={!sandboxId}
                  variant="unstyled"
                  className="flex items-center gap-1 rounded-md px-2 py-1 text-2xs text-text-quaternary transition-colors duration-200 hover:text-text-secondary disabled:opacity-50 dark:text-text-dark-quaternary dark:hover:text-text-dark-secondary"
                >
                  <Plus className="h-3 w-3" />
                  Add Variable
                </Button>
              </div>
            </div>
          )
        )}
      </div>
    </div>
  );
});
