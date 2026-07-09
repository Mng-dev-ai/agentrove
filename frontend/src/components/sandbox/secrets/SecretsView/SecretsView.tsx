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
import clsx from 'clsx';
import styles from './SecretsView.module.scss';

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
    <div className={styles['secrets-view']}>
      <div className={styles.header}>
        <span className={styles['header-title']}>Environment Variables</span>
        <div className={styles['header-actions']}>
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
        <div className={styles.warning}>
          <AlertTriangle className={styles['warning-icon']} />
          <p>No sandbox connected. Start a chat to manage environment variables.</p>
        </div>
      )}

      <div className={styles.body}>
        {isLoading && (
          <div className={styles.loading}>
            <Spinner size="md" className={styles.spinner} />
          </div>
        )}

        {!isLoading && secrets.length === 0 ? (
          <div className={styles.empty}>
            <p className={styles['empty-text']}>No variables yet</p>
            <Button
              onClick={handleAddSecret}
              disabled={!sandboxId}
              variant="unstyled"
              className={styles['add-button']}
            >
              <Plus className={styles['icon-xs']} />
              Add Variable
            </Button>
          </div>
        ) : (
          !isLoading && (
            <div className={styles.list}>
              {secrets.map(
                (secret, index) =>
                  !secret.isDeleted && (
                    <div
                      key={secret.originalKey ?? `new-${index}`}
                      className={clsx(
                        styles.row,
                        (secret.isNew || secret.isModified) && styles['row--dirty'],
                      )}
                    >
                      <div className={styles.fields}>
                        <Input
                          type="text"
                          value={secret.key}
                          onChange={(e) => handleUpdateSecret(index, 'key', e.target.value)}
                          placeholder="KEY"
                          aria-label="Secret key"
                          className={styles['field-input']}
                          variant="unstyled"
                        />
                        <div className={styles['value-field']}>
                          <Input
                            type={showValues[index] ? 'text' : 'password'}
                            value={secret.value}
                            onChange={(e) => handleUpdateSecret(index, 'value', e.target.value)}
                            placeholder="VALUE"
                            aria-label="Secret value"
                            className={clsx(styles['field-input'], styles['field-input--value'])}
                            variant="unstyled"
                          />
                          <Button
                            onClick={() => toggleShowValue(index)}
                            variant="unstyled"
                            aria-label={showValues[index] ? 'Hide secret' : 'Show secret'}
                            className={styles['value-toggle']}
                          >
                            {showValues[index] ? (
                              <EyeOff className={styles['icon-xs']} />
                            ) : (
                              <Eye className={styles['icon-xs']} />
                            )}
                          </Button>
                        </div>
                      </div>
                      <Button
                        onClick={() => handleRemoveSecret(index)}
                        variant="unstyled"
                        aria-label="Delete secret"
                        className={styles['row-delete']}
                      >
                        <Trash2 className={styles['icon-xs']} />
                      </Button>
                    </div>
                  ),
              )}

              <div className={styles['add-footer']}>
                <Button
                  onClick={handleAddSecret}
                  disabled={!sandboxId}
                  variant="unstyled"
                  className={styles['add-button-footer']}
                >
                  <Plus className={styles['icon-xs']} />
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
