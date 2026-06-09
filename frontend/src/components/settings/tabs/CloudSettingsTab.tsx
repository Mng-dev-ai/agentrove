import { useState } from 'react';
import toast from 'react-hot-toast';
import { CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button';
import { Input } from '@/components/ui/primitives/Input';
import { Label } from '@/components/ui/primitives/Label';
import { useCloudSettingsStore } from '@/store/cloudSettingsStore';
import { cloudChatService } from '@/services/cloudChatService';

// Connects the desktop to a remote AgentRove (VPS) instance so chats can be run
// there with "Cloud" execution mode. All state here is client-side only.
export function CloudSettingsTab() {
  const cloudUrl = useCloudSettingsStore((state) => state.cloudUrl);
  const connectedEmail = useCloudSettingsStore((state) => state.connectedEmail);

  const [url, setUrl] = useState(cloudUrl);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);

  const handleConnect = async () => {
    // Normalize a bare host to https:// so the base URL is absolute, not relative.
    let normalizedUrl = url.trim();
    if (normalizedUrl && !/^https?:\/\//i.test(normalizedUrl)) {
      normalizedUrl = `https://${normalizedUrl}`;
    }
    if (!normalizedUrl || !email.trim() || !password) {
      toast.error('Enter the cloud URL, email, and password');
      return;
    }
    try {
      new URL(normalizedUrl);
    } catch {
      toast.error('Enter a valid cloud URL');
      return;
    }
    setIsConnecting(true);
    try {
      await cloudChatService.connect(normalizedUrl, email.trim(), password);
      setPassword('');
      toast.success('Connected to cloud instance');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to connect to cloud instance');
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDisconnect = () => {
    cloudChatService.disconnect();
    setEmail('');
    toast.success('Disconnected from cloud instance');
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border p-5 dark:border-border-dark">
        <h2 className="mb-1 text-xs font-medium text-text-tertiary dark:text-text-dark-tertiary">
          Cloud Instance
        </h2>
        <p className="mb-4 text-2xs text-text-quaternary dark:text-text-dark-quaternary">
          Run chats on a separate AgentRove instance (e.g. your VPS) so they keep running after you
          close this app. The instance must allow this app&apos;s origin in its{' '}
          <span className="font-mono">ALLOWED_ORIGINS</span>.
        </p>

        {connectedEmail ? (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2 text-xs text-text-secondary dark:text-text-dark-secondary">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-success-600 dark:text-success-400" />
              <span>
                Connected to <span className="font-mono">{cloudUrl}</span> as{' '}
                <span className="font-medium">{connectedEmail}</span>
              </span>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={handleDisconnect}>
              Disconnect
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <Label className="mb-1 text-xs text-text-secondary dark:text-text-dark-secondary">
                Cloud URL
              </Label>
              <Input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://your-vps.example.com"
                autoComplete="off"
              />
            </div>
            <div>
              <Label className="mb-1 text-xs text-text-secondary dark:text-text-dark-secondary">
                Email
              </Label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="off"
              />
            </div>
            <div>
              <Label className="mb-1 text-xs text-text-secondary dark:text-text-dark-secondary">
                Password
              </Label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="off"
              />
            </div>
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={handleConnect}
              isLoading={isConnecting}
              loadingText="Connecting..."
            >
              Connect
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
