import { useState } from 'react';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import { Button } from '@/components/ui/primitives/Button/Button';
import { Input } from '@/components/ui/primitives/Input/Input';
import { Label } from '@/components/ui/primitives/Label/Label';
import { useCloudSettingsStore } from '@/store/cloudSettingsStore';
import { cloudChatService } from '@/services/cloudChatService';
import {
  useCloudActiveStreamsQuery,
  useCloudChatsTotalQuery,
  useCloudWorkspacesQuery,
} from '@/hooks/queries/useCloudQueries';
import styles from './CloudSettingsTab.module.scss';

function StatusPill({ connected }: { connected: boolean }) {
  return (
    <span className={styles['status-pill']}>
      <span
        className={clsx(styles.dot, connected ? styles['dot--connected'] : styles['dot--offline'])}
      />
      {connected ? 'Connected' : 'Not connected'}
    </span>
  );
}

function StatTile({ label, value }: { label: string; value: number | undefined }) {
  return (
    <div className={styles['stat-tile']}>
      <div className={styles['stat-value']}>{value ?? '—'}</div>
      <div className={styles['stat-label']}>{label}</div>
    </div>
  );
}

function SetupStep({ step, children }: { step: number; children: React.ReactNode }) {
  return (
    <li className={styles.step}>
      <span className={styles['step-num']}>{step}</span>
      <span className={styles['step-text']}>{children}</span>
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
      <div className={styles.cloud}>
        <div className={styles.card}>
          <div className={styles['card-header']}>
            <h2 className={styles.url}>{cloudUrl}</h2>
            <StatusPill connected />
          </div>
          <p className={styles['signed-in']}>
            Signed in as <span className={styles.email}>{connectedEmail}</span>
          </p>
          <div className={styles.stats}>
            <StatTile label="Workspaces" value={workspacesQuery.data?.length} />
            <StatTile label="Running chats" value={activeStreamsQuery.data?.length} />
            <StatTile label="Total chats" value={chatsTotalQuery.data} />
          </div>
          <div className={styles.actions}>
            <Button type="button" variant="outline" size="sm" onClick={handleDisconnect}>
              Disconnect
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.cloud}>
      <div className={styles.card}>
        <div className={styles['instance-header']}>
          <h2 className={styles['instance-title']}>Cloud Instance</h2>
          <StatusPill connected={false} />
        </div>
        <p className={styles['instance-desc']}>
          Run chats on a separate AgentRove instance (e.g. your VPS) so they keep running after you
          close this app.
        </p>
        <div className={styles.form}>
          <div>
            <Label className={styles.label}>Cloud URL</Label>
            <Input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://your-vps.example.com"
              autoComplete="off"
            />
          </div>
          <div className={styles.grid}>
            <div>
              <Label className={styles.label}>Email</Label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="off"
              />
            </div>
            <div>
              <Label className={styles.label}>Password</Label>
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
      <div className={styles.card}>
        <h2 className={styles['before-title']}>Before You Connect</h2>
        <ol className={styles.steps}>
          <SetupStep step={1}>Deploy AgentRove on your server</SetupStep>
          <SetupStep step={2}>
            Add this app&apos;s origin to its <span className={styles.mono}>ALLOWED_ORIGINS</span>
          </SetupStep>
          <SetupStep step={3}>Sign in with an account on that instance</SetupStep>
        </ol>
      </div>
    </div>
  );
}
