import { useState, useEffect } from 'react';
import { Mail, Check, X, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button';
import { Input } from '@/components/ui/primitives/Input';
import { Switch } from '@/components/ui/primitives/Switch';
import { Label } from '@/components/ui/primitives/Label';
import { cn } from '@/utils/cn';
import { settingsService } from '@/services/settingsService';
import type { SmtpStatusResponse, SmtpConfigRequest } from '@/types/system.types';
import toast from 'react-hot-toast';

interface SmtpIntegrationCardProps {
  className?: string;
}

export function SmtpIntegrationCard({ className }: SmtpIntegrationCardProps) {
  const [status, setStatus] = useState<SmtpStatusResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isConfiguring, setIsConfiguring] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [testEmail, setTestEmail] = useState('');

  const [formData, setFormData] = useState<SmtpConfigRequest>({
    host: '',
    port: 587,
    username: '',
    password: '',
    from_email: '',
    from_name: '',
    use_tls: true,
    use_ssl: false,
    enabled: true,
  });

  useEffect(() => {
    loadStatus();
  }, []);

  const loadStatus = async () => {
    setIsLoading(true);
    try {
      const result = await settingsService.getSmtpSettings();
      setStatus(result);
      if (result.host) {
        setFormData({
          host: result.host || '',
          port: result.port || 587,
          username: result.username || '',
          password: '',
          from_email: result.from_email || '',
          from_name: result.from_name || '',
          use_tls: result.use_tls,
          use_ssl: result.use_ssl,
          enabled: result.enabled,
        });
      }
    } catch {
      toast.error('Failed to load SMTP settings');
    } finally {
      setIsLoading(false);
    }
  };

  const handleConfigure = async () => {
    if (!formData.host || !formData.port || !formData.from_email) {
      toast.error('Host, port, and from email are required');
      return;
    }

    setIsConfiguring(true);
    try {
      await settingsService.configureSmtp(formData);
      toast.success('SMTP settings saved');
      setShowConfig(false);
      await loadStatus();
    } catch {
      toast.error('Failed to save SMTP settings');
    } finally {
      setIsConfiguring(false);
    }
  };

  const handleDisconnect = async () => {
    setIsConfiguring(true);
    try {
      await settingsService.disableSmtp();
      toast.success('SMTP disabled');
      setShowConfig(false);
      await loadStatus();
    } catch {
      toast.error('Failed to disable SMTP');
    } finally {
      setIsConfiguring(false);
    }
  };

  const handleTest = async () => {
    if (!testEmail) {
      toast.error('Please enter a test email address');
      return;
    }

    setIsTesting(true);
    try {
      await settingsService.testSmtp(testEmail);
      toast.success(`Test email sent to ${testEmail}`);
    } catch (error) {
      toast.error('Failed to send test email');
    } finally {
      setIsTesting(false);
    }
  };

  const updateForm = <K extends keyof SmtpConfigRequest>(key: K, value: SmtpConfigRequest[K]) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
  };

  if (isLoading) {
    return (
      <div className={cn('rounded-xl border border-border p-5 dark:border-border-dark', className)}>
        <div className="flex items-center justify-center py-4">
          <Loader2 className="h-5 w-5 animate-spin text-text-quaternary dark:text-text-dark-quaternary" />
        </div>
      </div>
    );
  }

  const isConnected = status?.enabled && status?.host;

  return (
    <div className={cn('rounded-xl border border-border p-5 dark:border-border-dark', className)}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-surface-tertiary dark:bg-surface-dark-tertiary">
            <Mail className="h-5 w-5 text-text-secondary dark:text-text-dark-secondary" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-medium text-text-primary dark:text-text-dark-primary">
                SMTP Email
              </h3>
              {isConnected ? (
                <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
                  <Check className="h-3 w-3" />
                  Connected
                </span>
              ) : (
                <span className="flex items-center gap-1 text-xs text-text-quaternary dark:text-text-dark-quaternary">
                  <X className="h-3 w-3" />
                  Not configured
                </span>
              )}
            </div>
            <p className="mt-0.5 text-xs text-text-tertiary dark:text-text-dark-tertiary">
              Configure SMTP for sending emails
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          {isConnected && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowConfig(!showConfig)}
            >
              {showConfig ? 'Cancel' : 'Edit'}
            </Button>
          )}
          {!isConnected && !showConfig && (
            <Button
              variant="primary"
              size="sm"
              onClick={() => setShowConfig(true)}
            >
              Configure
            </Button>
          )}
        </div>
      </div>

      {showConfig && (
        <div className="mt-4 space-y-4 border-t border-border pt-4 dark:border-border-dark">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label className="mb-1.5 text-2xs text-text-secondary dark:text-text-dark-secondary">
                SMTP Host *
              </Label>
              <Input
                value={formData.host}
                onChange={(e) => updateForm('host', e.target.value)}
                placeholder="smtp.example.com"
              />
            </div>
            <div>
              <Label className="mb-1.5 text-2xs text-text-secondary dark:text-text-dark-secondary">
                Port *
              </Label>
              <Input
                type="number"
                value={formData.port}
                onChange={(e) => updateForm('port', parseInt(e.target.value) || 587)}
                placeholder="587"
              />
            </div>
            <div>
              <Label className="mb-1.5 text-2xs text-text-secondary dark:text-text-dark-secondary">
                Username
              </Label>
              <Input
                value={formData.username || ''}
                onChange={(e) => updateForm('username', e.target.value)}
                placeholder="username"
              />
            </div>
            <div>
              <Label className="mb-1.5 text-2xs text-text-secondary dark:text-text-dark-secondary">
                Password {status?.has_password && '(leave empty to keep current)'}
              </Label>
              <Input
                type="password"
                value={formData.password || ''}
                onChange={(e) => updateForm('password', e.target.value)}
                placeholder="••••••••"
              />
            </div>
            <div>
              <Label className="mb-1.5 text-2xs text-text-secondary dark:text-text-dark-secondary">
                From Email *
              </Label>
              <Input
                type="email"
                value={formData.from_email}
                onChange={(e) => updateForm('from_email', e.target.value)}
                placeholder="noreply@example.com"
              />
            </div>
            <div>
              <Label className="mb-1.5 text-2xs text-text-secondary dark:text-text-dark-secondary">
                From Name
              </Label>
              <Input
                value={formData.from_name || ''}
                onChange={(e) => updateForm('from_name', e.target.value)}
                placeholder="Claudex"
              />
            </div>
          </div>

          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <Switch
                checked={formData.use_tls}
                onCheckedChange={(checked) => updateForm('use_tls', checked)}
                size="sm"
              />
              <Label className="text-xs text-text-secondary dark:text-text-dark-secondary">
                Use TLS (STARTTLS)
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                checked={formData.use_ssl}
                onCheckedChange={(checked) => updateForm('use_ssl', checked)}
                size="sm"
              />
              <Label className="text-xs text-text-secondary dark:text-text-dark-secondary">
                Use SSL
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                checked={formData.enabled}
                onCheckedChange={(checked) => updateForm('enabled', checked)}
                size="sm"
              />
              <Label className="text-xs text-text-secondary dark:text-text-dark-secondary">
                Enabled
              </Label>
            </div>
          </div>

          {isConnected && (
            <div className="flex items-end gap-2 border-t border-border pt-4 dark:border-border-dark">
              <div className="flex-1">
                <Label className="mb-1.5 text-2xs text-text-secondary dark:text-text-dark-secondary">
                  Test Email
                </Label>
                <Input
                  type="email"
                  value={testEmail}
                  onChange={(e) => setTestEmail(e.target.value)}
                  placeholder="test@example.com"
                />
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleTest}
                isLoading={isTesting}
              >
                Send Test
              </Button>
            </div>
          )}

          <div className="flex justify-between gap-2 border-t border-border pt-4 dark:border-border-dark">
            {isConnected && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleDisconnect}
                className="text-red-500 hover:text-red-600 dark:text-red-400 dark:hover:text-red-300"
              >
                Disable SMTP
              </Button>
            )}
            <div className="flex flex-1 justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowConfig(false)}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={handleConfigure}
                isLoading={isConfiguring}
              >
                Save Settings
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
