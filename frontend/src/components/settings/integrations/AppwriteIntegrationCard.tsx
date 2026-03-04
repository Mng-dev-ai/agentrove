import { useState } from 'react';
import { Server, Link2, Unlink, ExternalLink, CheckCircle2, RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/primitives/Badge';
import { Button } from '@/components/ui/primitives/Button';
import { Input } from '@/components/ui/primitives/Input';
import { Label } from '@/components/ui/primitives/Label';
import { Spinner } from '@/components/ui/primitives/Spinner';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import type { AppwriteStatus, AppwriteConfig } from '@/services/integrationsService';

interface AppwriteIntegrationCardProps {
  status: AppwriteStatus;
  isLoading: boolean;
  onConfigure: (config: AppwriteConfig) => void;
  isConfiguring: boolean;
  onDisconnect: () => void;
  isDisconnecting: boolean;
  onValidate: () => void;
  isValidating: boolean;
}

export const AppwriteIntegrationCard: React.FC<AppwriteIntegrationCardProps> = ({
  status,
  isLoading,
  onConfigure,
  isConfiguring,
  onDisconnect,
  isDisconnecting,
  onValidate,
  isValidating,
}) => {
  const [endpoint, setEndpoint] = useState('');
  const [projectId, setProjectId] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [isDisconnectDialogOpen, setIsDisconnectDialogOpen] = useState(false);

  const formatDate = (dateString: string | null) => {
    if (!dateString) return '';
    return new Date(dateString).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const handleConfigure = () => {
    if (!endpoint.trim() || !projectId.trim() || !apiKey.trim()) return;
    onConfigure({
      endpoint: endpoint.trim(),
      project_id: projectId.trim(),
      api_key: apiKey.trim(),
    });
    setEndpoint('');
    setProjectId('');
    setApiKey('');
  };

  if (isLoading) {
    return (
      <div className="rounded-xl border border-border p-5 dark:border-border-dark">
        <div className="flex items-center justify-center py-8">
          <Spinner size="md" />
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border p-5 dark:border-border-dark">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-surface-tertiary dark:bg-surface-dark-tertiary">
            <Server className="h-4 w-4 text-text-tertiary dark:text-text-dark-tertiary" />
          </div>
          <div>
            <h3 className="text-sm font-medium text-text-primary dark:text-text-dark-primary">
              Appwrite
            </h3>
            <p className="text-xs text-text-tertiary dark:text-text-dark-tertiary">
              Backend platform with auth, database, and storage
            </p>
          </div>
        </div>
        <div>
          {status.connected ? (
            <Badge variant="success" className="flex items-center gap-1">
              <CheckCircle2 className="h-3 w-3" />
              Connected
            </Badge>
          ) : (
            <Badge variant="secondary">Not configured</Badge>
          )}
        </div>
      </div>

      <div className="mt-4">
        {!status.connected && (
          <div className="space-y-4">
            <div className="rounded-xl border border-border p-4 dark:border-border-dark">
              <h4 className="mb-2 text-xs font-medium text-text-primary dark:text-text-dark-primary">
                Setup Instructions
              </h4>
              <ol className="list-inside list-decimal space-y-1 text-xs text-text-secondary dark:text-text-dark-secondary">
                <li>
                  Go to{' '}
                  <a
                    href="https://cloud.appwrite.io"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-text-primary underline dark:text-text-dark-primary"
                  >
                    Appwrite Cloud
                    <ExternalLink className="ml-1 inline h-3 w-3" />
                  </a>{' '}
                  or use your self-hosted instance
                </li>
                <li>
                  For cloud: use https://cloud.appwrite.io/v1
                </li>
                <li>
                  For self-hosted: use your instance URL (e.g., http://localhost/v1)
                </li>
                <li>
                  Get your Project ID and API key from Project Settings → API Keys
                </li>
              </ol>
            </div>

            <div className="space-y-3">
              <div>
                <Label className="mb-1.5 text-2xs text-text-secondary dark:text-text-dark-secondary">
                  Endpoint URL
                </Label>
                <Input
                  value={endpoint}
                  onChange={(e) => setEndpoint(e.target.value)}
                  placeholder="https://cloud.appwrite.io/v1"
                />
              </div>
              <div>
                <Label className="mb-1.5 text-2xs text-text-secondary dark:text-text-dark-secondary">
                  Project ID
                </Label>
                <Input
                  value={projectId}
                  onChange={(e) => setProjectId(e.target.value)}
                  placeholder="6789abcdef..."
                />
              </div>
              <div>
                <Label className="mb-1.5 text-2xs text-text-secondary dark:text-text-dark-secondary">
                  API Key
                </Label>
                <Input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="Standard... or your API key"
                />
              </div>

              <Button
                variant="primary"
                size="sm"
                onClick={handleConfigure}
                disabled={!endpoint.trim() || !projectId.trim() || !apiKey.trim() || isConfiguring}
                className="w-full"
              >
                {isConfiguring ? <Spinner size="sm" /> : <Link2 className="h-3.5 w-3.5" />}
                Connect Appwrite
              </Button>
            </div>
          </div>
        )}

        {status.connected && (
          <div className="space-y-4">
            <div className="rounded-xl border border-border p-3 dark:border-border-dark">
              <div className="flex items-center justify-between">
                <div>
                  <p className="truncate text-xs font-medium text-text-primary dark:text-text-dark-primary">
                    {status.endpoint}
                  </p>
                  <p className="text-xs text-text-quaternary dark:text-text-dark-quaternary">
                    Project: {status.project_id}
                  </p>
                  {status.connected_at && (
                    <p className="text-xs text-text-tertiary dark:text-text-dark-tertiary">
                      Connected {formatDate(status.connected_at)}
                    </p>
                  )}
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={onValidate}
                disabled={isValidating}
                className="flex-1"
              >
                {isValidating ? <Spinner size="sm" /> : <RefreshCw className="h-3.5 w-3.5" />}
                Validate
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsDisconnectDialogOpen(true)}
                disabled={isDisconnecting}
                className="flex-1"
              >
                {isDisconnecting ? <Spinner size="sm" /> : <Unlink className="h-3.5 w-3.5" />}
                Disconnect
              </Button>
            </div>
          </div>
        )}
      </div>

      <ConfirmDialog
        isOpen={isDisconnectDialogOpen}
        onClose={() => setIsDisconnectDialogOpen(false)}
        onConfirm={() => {
          onDisconnect();
          setIsDisconnectDialogOpen(false);
        }}
        title="Disconnect Appwrite"
        message="Are you sure you want to disconnect Appwrite? Your credentials will be removed."
        confirmLabel="Disconnect"
        cancelLabel="Cancel"
      />
    </div>
  );
};
