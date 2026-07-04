import { useState } from 'react';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui/primitives/Button';
import { Input } from '@/components/ui/primitives/Input';
import { Label } from '@/components/ui/primitives/Label';
import { useCloudSettingsStore } from '@/store/cloudSettingsStore';
import { cloudChatService } from '@/services/cloudChatService';
import {
  useCloudActiveStreamsQuery,
  useCloudChatsTotalQuery,
  useCloudWorkspacesQuery,
} from '@/hooks/queries/useCloudQueries';
import { cn } from '@/utils/cn';

function StatusPill({ connected }: { connected: boolean }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border/50 px-2 py-0.5 text-2xs text-text-tertiary dark:border-border-dark/50 dark:text-text-dark-tertiary">
      <span
        className={cn(
          'h-1.5 w-1.5 rounded-full',
          connected
            ? 'bg-success-500 dark:bg-success-400'
            : 'bg-text-quaternary dark:bg-text-dark-quaternary',
        )}
      />
      {connected ? 'Connected' : 'Not connected'}
    </span>
  );
}

function StatTile({ label, value }: { label: string; value: number | undefined }) {
  return (
    <div className="rounded-lg border border-border/50 px-3 py-2 dark:border-border-dark/50">
      <div className="text-sm font-medium text-text-primary dark:text-text-dark-primary">
        {value ?? '—'}
      </div>
      <div className="text-2xs text-text-quaternary dark:text-text-dark-quaternary">{label}</div>
    </div>
  );
}

function SetupStep({ step, children }: { step: number; children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-2.5">
      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-border/50 text-2xs text-text-tertiary dark:border-border-dark/50 dark:text-text-dark-tertiary">
        {step}
      </span>
      <span className="text-xs text-text-tertiary dark:text-text-dark-tertiary">{children}</span>
    </li>
  );
}

export function CloudSettingsTab() {
  // Connects the desktop to a remote AgentRove (VPS) instance so chats can run
  // there with "Cloud" execution mode. Connection state is client-side only.
  const cloudUrl = useCloudSettingsStore((state) => state.cloudUrl);
  const connectedEmail = useCloudSettingsStore((state) => state.connectedEmail);
  const isConnected = !!connectedEmail;

  const [url, setUrl] = useState(cloudUrl);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);

  const workspacesQuery = useCloudWorkspacesQuery(isConnected);
  const activeStreamsQuery = useCloudActiveStreamsQuery(isConnected);
  const chatsTotalQuery = useCloudChatsTotalQuery(isConnected);

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

  if (isConnected) {
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-border p-5 dark:border-border-dark">
          <div className="flex items-center justify-between gap-3">
            <h2 className="min-w-0 truncate font-mono text-xs font-medium text-text-primary dark:text-text-dark-primary">
              {cloudUrl}
            </h2>
            <StatusPill connected />
          </div>
          <p className="mt-1 text-2xs text-text-quaternary dark:text-text-dark-quaternary">
            Signed in as <span className="font-medium">{connectedEmail}</span>
          </p>
          <div className="mt-4 grid grid-cols-3 gap-2">
            <StatTile label="Workspaces" value={workspacesQuery.data?.length} />
            <StatTile label="Running chats" value={activeStreamsQuery.data?.length} />
            <StatTile label="Total chats" value={chatsTotalQuery.data} />
          </div>
          <div className="mt-4 flex justify-end">
            <Button type="button" variant="outline" size="sm" onClick={handleDisconnect}>
              Disconnect
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border p-5 dark:border-border-dark">
        <div className="mb-1 flex items-center justify-between gap-3">
          <h2 className="text-xs font-medium text-text-tertiary dark:text-text-dark-tertiary">
            Cloud Instance
          </h2>
          <StatusPill connected={false} />
        </div>
        <p className="mb-4 text-2xs text-text-quaternary dark:text-text-dark-quaternary">
          Run chats on a separate AgentRove instance (e.g. your VPS) so they keep running after you
          close this app.
        </p>
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
          <div className="grid gap-3 sm:grid-cols-2">
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
      </div>
      <div className="rounded-xl border border-border p-5 dark:border-border-dark">
        <h2 className="mb-3 text-xs font-medium text-text-tertiary dark:text-text-dark-tertiary">
          Before You Connect
        </h2>
        <ol className="space-y-2">
          <SetupStep step={1}>Deploy AgentRove on your server</SetupStep>
          <SetupStep step={2}>
            Add this app&apos;s origin to its <span className="font-mono">ALLOWED_ORIGINS</span>
          </SetupStep>
          <SetupStep step={3}>Sign in with an account on that instance</SetupStep>
        </ol>
      </div>
    </div>
  );
}
