import { useState } from 'react';
import { Database, Server, Key, Shield, Link2, Unlink, CheckCircle2 } from 'lucide-react';
import { Badge } from '@/components/ui/primitives/Badge';
import { Button } from '@/components/ui/primitives/Button';
import { Input } from '@/components/ui/primitives/Input';
import { Label } from '@/components/ui/primitives/Label';
import { Spinner } from '@/components/ui/primitives/Spinner';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import {
  useSystemStatus,
  useSetMasterPassword,
  useConfigureRemoteDb,
  useDisableRemoteDb,
} from '@/hooks/useSystemConfig';

export function DatabaseConfigSection() {
  const { status, isLoading } = useSystemStatus();
  const setMasterPasswordMutation = useSetMasterPassword();
  const configureRemoteDb = useConfigureRemoteDb();
  const disableRemoteDb = useDisableRemoteDb();

  const [masterPassword, setMasterPassword] = useState('');
  const [dbUrl, setDbUrl] = useState('');
  const [verifyPassword, setVerifyPassword] = useState('');
  const [showMasterPasswordForm, setShowMasterPasswordForm] = useState(false);
  const [showRemoteDbForm, setShowRemoteDbForm] = useState(false);
  const [isDisconnectDialogOpen, setIsDisconnectDialogOpen] = useState(false);

  const handleSetMasterPassword = () => {
    if (!masterPassword.trim() || masterPassword.length < 8) {
      return;
    }
    setMasterPasswordMutation.mutate({ password: masterPassword });
    setMasterPassword('');
    setShowMasterPasswordForm(false);
  };

  const handleConfigureRemoteDb = () => {
    if (!dbUrl.trim()) return;
    configureRemoteDb.mutate({
      db_url: dbUrl.trim(),
      enabled: true,
      master_password: verifyPassword.trim() || undefined,
    });
    setDbUrl('');
    setVerifyPassword('');
    setShowRemoteDbForm(false);
  };

  const handleDisconnectRemoteDb = () => {
    disableRemoteDb.mutate();
    setIsDisconnectDialogOpen(false);
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
    <div className="space-y-6">
      <div>
        <h2 className="text-sm font-medium text-text-primary dark:text-text-dark-primary">
          Database Configuration
        </h2>
        <p className="mt-1 text-xs text-text-tertiary dark:text-text-dark-tertiary">
          Configure remote database connection and master password for local-to-web synchronization.
        </p>
      </div>

      {/* Instance Status */}
      <div className="rounded-xl border border-border p-4 dark:border-border-dark">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-surface-tertiary dark:bg-surface-dark-tertiary">
              <Server className="h-4 w-4 text-text-tertiary dark:text-text-dark-tertiary" />
            </div>
            <div>
              <p className="text-xs font-medium text-text-primary dark:text-text-dark-primary">
                Instance Mode
              </p>
              <p className="text-xs text-text-tertiary dark:text-text-dark-tertiary">
                {status?.is_web_master ? 'Web Master' : 'Local Application'}
              </p>
            </div>
          </div>
          {status?.is_web_master && (
            <Badge variant="success" className="flex items-center gap-1">
              <CheckCircle2 className="h-3 w-3" />
              Master
            </Badge>
          )}
        </div>
      </div>

      {/* Master Password Section */}
      <div className="rounded-xl border border-border p-4 dark:border-border-dark">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-surface-tertiary dark:bg-surface-dark-tertiary">
              <Shield className="h-4 w-4 text-text-tertiary dark:text-text-dark-tertiary" />
            </div>
            <div>
              <p className="text-xs font-medium text-text-primary dark:text-text-dark-primary">
                Master Password
              </p>
              <p className="text-xs text-text-tertiary dark:text-text-dark-tertiary">
                {status?.has_master_password
                  ? 'Master password is set'
                  : 'Required for remote database connections'}
              </p>
            </div>
          </div>
          <div>
            {status?.has_master_password ? (
              <Badge variant="success" className="flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3" />
                Set
              </Badge>
            ) : (
              <Badge variant="secondary">Not set</Badge>
            )}
          </div>
        </div>

        {!status?.has_master_password && !showMasterPasswordForm && (
          <div className="mt-4">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowMasterPasswordForm(true)}
            >
              <Key className="h-3.5 w-3.5" />
              Set Master Password
            </Button>
          </div>
        )}

        {showMasterPasswordForm && (
          <div className="mt-4 space-y-3">
            <div>
              <Label className="mb-1.5 text-2xs text-text-secondary dark:text-text-dark-secondary">
                Master Password (min 8 characters)
              </Label>
              <Input
                type="password"
                value={masterPassword}
                onChange={(e) => setMasterPassword(e.target.value)}
                placeholder="Enter master password"
              />
            </div>
            <div className="flex gap-2">
              <Button
                variant="primary"
                size="sm"
                onClick={handleSetMasterPassword}
                disabled={masterPassword.length < 8 || setMasterPasswordMutation.isPending}
              >
                {setMasterPasswordMutation.isPending ? <Spinner size="sm" /> : 'Save'}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setShowMasterPasswordForm(false);
                  setMasterPassword('');
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Remote Database Section */}
      <div className="rounded-xl border border-border p-4 dark:border-border-dark">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-surface-tertiary dark:bg-surface-dark-tertiary">
              <Database className="h-4 w-4 text-text-tertiary dark:text-text-dark-tertiary" />
            </div>
            <div>
              <p className="text-xs font-medium text-text-primary dark:text-text-dark-primary">
                Remote Database
              </p>
              <p className="text-xs text-text-tertiary dark:text-text-dark-tertiary">
                {status?.remote_db_enabled
                  ? 'Connected to remote database'
                  : 'Connect to web master database'}
              </p>
            </div>
          </div>
          <div>
            {status?.remote_db_enabled ? (
              <Badge variant="success" className="flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3" />
                Connected
              </Badge>
            ) : (
              <Badge variant="secondary">Not connected</Badge>
            )}
          </div>
        </div>

        {!status?.remote_db_enabled && !showRemoteDbForm && (
          <div className="mt-4">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowRemoteDbForm(true)}
              disabled={!status?.has_master_password}
            >
              <Link2 className="h-3.5 w-3.5" />
              Connect to Remote DB
            </Button>
            {!status?.has_master_password && (
              <p className="mt-2 text-2xs text-text-quaternary dark:text-text-dark-quaternary">
                Set master password first
              </p>
            )}
          </div>
        )}

        {showRemoteDbForm && (
          <div className="mt-4 space-y-3">
            <div>
              <Label className="mb-1.5 text-2xs text-text-secondary dark:text-text-dark-secondary">
                Database URL
              </Label>
              <Input
                type="password"
                value={dbUrl}
                onChange={(e) => setDbUrl(e.target.value)}
                placeholder="postgresql://user:pass@host:5432/db"
              />
            </div>
            <div>
              <Label className="mb-1.5 text-2xs text-text-secondary dark:text-text-dark-secondary">
                Master Password
              </Label>
              <Input
                type="password"
                value={verifyPassword}
                onChange={(e) => setVerifyPassword(e.target.value)}
                placeholder="Enter master password"
              />
            </div>
            <div className="flex gap-2">
              <Button
                variant="primary"
                size="sm"
                onClick={handleConfigureRemoteDb}
                disabled={!dbUrl.trim() || configureRemoteDb.isPending}
              >
                {configureRemoteDb.isPending ? <Spinner size="sm" /> : <Link2 className="h-3.5 w-3.5" />}
                Connect
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setShowRemoteDbForm(false);
                  setDbUrl('');
                  setVerifyPassword('');
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        {status?.remote_db_enabled && (
          <div className="mt-4">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsDisconnectDialogOpen(true)}
              disabled={disableRemoteDb.isPending}
            >
              {disableRemoteDb.isPending ? <Spinner size="sm" /> : <Unlink className="h-3.5 w-3.5" />}
              Disconnect
            </Button>
          </div>
        )}
      </div>

      <ConfirmDialog
        isOpen={isDisconnectDialogOpen}
        onClose={() => setIsDisconnectDialogOpen(false)}
        onConfirm={handleDisconnectRemoteDb}
        title="Disconnect Remote Database"
        message="Are you sure you want to disconnect from the remote database? The application will use the local database."
        confirmLabel="Disconnect"
        cancelLabel="Cancel"
      />
    </div>
  );
}
