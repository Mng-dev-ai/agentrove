import { useState } from 'react';
import { Database, Link2, Unlink, ExternalLink, CheckCircle2, RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/primitives/Badge';
import { Button } from '@/components/ui/primitives/Button';
import { Input } from '@/components/ui/primitives/Input';
import { Label } from '@/components/ui/primitives/Label';
import { Spinner } from '@/components/ui/primitives/Spinner';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import type { SupabaseStatus, SupabaseConfig } from '@/services/integrationsService';

interface SupabaseIntegrationCardProps {
  status: SupabaseStatus;
  isLoading: boolean;
  onConfigure: (config: SupabaseConfig) => void;
  isConfiguring: boolean;
  onDisconnect: () => void;
  isDisconnecting: boolean;
  onValidate: () => void;
  isValidating: boolean;
}

export const SupabaseIntegrationCard: React.FC<SupabaseIntegrationCardProps> = ({
  status,
  isLoading,
  onConfigure,
  isConfiguring,
  onDisconnect,
  isDisconnecting,
  onValidate,
  isValidating,
}) => {
  const [url, setUrl] = useState('');
  const [anonKey, setAnonKey] = useState('');
  const [serviceRoleKey, setServiceRoleKey] = useState('');
  const [showServiceRole, setShowServiceRole] = useState(false);
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
    if (!url.trim() || !anonKey.trim()) return;
    onConfigure({
      url: url.trim(),
      anon_key: anonKey.trim(),
      service_role_key: serviceRoleKey.trim() || undefined,
    });
    setUrl('');
    setAnonKey('');
    setServiceRoleKey('');
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
            <Database className="h-4 w-4 text-text-tertiary dark:text-text-dark-tertiary" />
          </div>
          <div>
            <h3 className="text-sm font-medium text-text-primary dark:text-text-dark-primary">
              Supabase
            </h3>
            <p className="text-xs text-text-tertiary dark:text-text-dark-tertiary">
              PostgreSQL database, authentication, and storage
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
                    href="https://supabase.com/dashboard"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-text-primary underline dark:text-text-dark-primary"
                  >
                    Supabase Dashboard
                    <ExternalLink className="ml-1 inline h-3 w-3" />
                  </a>
                </li>
                <li>
                  For cloud: use your project URL (e.g., https://xyz.supabase.co)
                </li>
                <li>
                  For self-hosted: use your instance URL
                </li>
                <li>
                  Get your anon/public key from Project Settings → API
                </li>
              </ol>
            </div>

            <div className="space-y-3">
              <div>
                <Label className="mb-1.5 text-2xs text-text-secondary dark:text-text-dark-secondary">
                  Project URL
                </Label>
                <Input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://your-project.supabase.co"
                />
              </div>
              <div>
                <Label className="mb-1.5 text-2xs text-text-secondary dark:text-text-dark-secondary">
                  Anon / Public Key
                </Label>
                <Input
                  type="password"
                  value={anonKey}
                  onChange={(e) => setAnonKey(e.target.value)}
                  placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
                />
              </div>

              <button
                type="button"
                onClick={() => setShowServiceRole(!showServiceRole)}
                className="text-2xs text-text-tertiary hover:text-text-secondary dark:text-text-dark-tertiary dark:hover:text-text-dark-secondary"
              >
                {showServiceRole ? 'Hide' : 'Show'} service role key (optional)
              </button>

              {showServiceRole && (
                <div>
                  <Label className="mb-1.5 text-2xs text-text-secondary dark:text-text-dark-secondary">
                    Service Role Key (optional)
                  </Label>
                  <Input
                    type="password"
                    value={serviceRoleKey}
                    onChange={(e) => setServiceRoleKey(e.target.value)}
                    placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
                  />
                </div>
              )}

              <Button
                variant="primary"
                size="sm"
                onClick={handleConfigure}
                disabled={!url.trim() || !anonKey.trim() || isConfiguring}
                className="w-full"
              >
                {isConfiguring ? <Spinner size="sm" /> : <Link2 className="h-3.5 w-3.5" />}
                Connect Supabase
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
                    {status.url}
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
        title="Disconnect Supabase"
        message="Are you sure you want to disconnect Supabase? Your credentials will be removed."
        confirmLabel="Disconnect"
        cancelLabel="Cancel"
      />
    </div>
  );
};
