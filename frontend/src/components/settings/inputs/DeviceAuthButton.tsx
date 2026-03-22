import { useState, useRef, useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/primitives/Button';
import { Check, Loader2, ExternalLink, Copy, CheckCheck, X, ArrowRight } from 'lucide-react';
import { apiClient } from '@/lib/api';
import { copyToClipboard } from '@/hooks/useClipboard';

interface DeviceCodeResponse {
  verification_uri: string;
  user_code: string;
  device_code: string;
  interval: number;
  expires_in: number;
}

interface PollTokenResponse {
  status: string;
  access_token: string | null;
  refresh_token: string | null;
  interval?: number;
}

export interface DeviceAuthConfig {
  deviceCodeEndpoint: string;
  pollTokenEndpoint: string;
  buildPollBody: (resp: DeviceCodeResponse) => Record<string, string>;
  buildResult: (pollResp: PollTokenResponse) => string;
  labels: {
    login: string;
    connected: string;
    helperText: string;
    errorPrefix: string;
  };
}

interface DeviceAuthButtonProps {
  value: string | null;
  onChange: (token: string | null) => void;
  config: DeviceAuthConfig;
}

export const DeviceAuthButton: React.FC<DeviceAuthButtonProps> = ({ value, onChange, config }) => {
  const [state, setState] = useState<'idle' | 'waiting' | 'success' | 'error'>('idle');
  const [deviceInfo, setDeviceInfo] = useState<{ uri: string; code: string } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pollIntervalMs, setPollIntervalMs] = useState(5000);
  const pollingRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollIntervalMsRef = useRef<number>(5000);
  const flowIdRef = useRef<number>(0);

  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearTimeout(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  useEffect(
    () => () => {
      flowIdRef.current += 1;
      stopPolling();
    },
    [stopPolling],
  );

  const schedulePolling = useCallback(
    (pollFn: () => Promise<void>, flowId: number) => {
      stopPolling();
      pollingRef.current = setTimeout(() => {
        if (flowId !== flowIdRef.current) {
          return;
        }
        void pollFn();
      }, pollIntervalMsRef.current);
    },
    [stopPolling],
  );

  const copyCode = useCallback(async () => {
    if (!deviceInfo) return;
    await copyToClipboard(deviceInfo.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [deviceInfo]);

  const startDeviceFlow = async () => {
    setState('waiting');
    setDeviceInfo(null);
    setErrorMsg(null);
    flowIdRef.current += 1;
    const flowId = flowIdRef.current;
    stopPolling();

    try {
      const resp = await apiClient.post<DeviceCodeResponse>(config.deviceCodeEndpoint);
      if (!resp) {
        throw new Error('Empty response');
      }
      if (flowId !== flowIdRef.current) {
        return;
      }

      setDeviceInfo({ uri: resp.verification_uri, code: resp.user_code });

      pollIntervalMsRef.current = (resp.interval + 3) * 1000;
      setPollIntervalMs(pollIntervalMsRef.current);
      const expiresAt = Date.now() + resp.expires_in * 1000;

      const poll = async () => {
        if (flowId !== flowIdRef.current) {
          return;
        }
        if (Date.now() > expiresAt) {
          stopPolling();
          setState('error');
          setErrorMsg('Authorization timed out. Please try again.');
          return;
        }

        try {
          const pollResp = await apiClient.post<PollTokenResponse>(
            config.pollTokenEndpoint,
            config.buildPollBody(resp),
          );

          if (pollResp?.status === 'success' && pollResp.access_token) {
            stopPolling();
            onChange(config.buildResult(pollResp));
            setState('success');
            return;
          }

          if (pollResp?.status === 'slow_down') {
            const nextInterval =
              typeof pollResp.interval === 'number' && pollResp.interval > 0
                ? pollResp.interval + 3
                : Math.floor(pollIntervalMsRef.current / 1000) + 5;
            pollIntervalMsRef.current = nextInterval * 1000;
            setPollIntervalMs(pollIntervalMsRef.current);
          }
        } catch {
          if (flowId !== flowIdRef.current) {
            return;
          }
          stopPolling();
          setState('error');
          setErrorMsg('Authorization failed. Please try again.');
          return;
        }

        if (flowId === flowIdRef.current) {
          schedulePolling(poll, flowId);
        }
      };

      schedulePolling(poll, flowId);
    } catch {
      if (flowId !== flowIdRef.current) {
        return;
      }
      setState('error');
      setErrorMsg(`Failed to start ${config.labels.errorPrefix} authorization.`);
    }
  };

  const cancelFlow = () => {
    flowIdRef.current += 1;
    stopPolling();
    setState('idle');
  };

  return (
    <div className="w-full">
      {value && state !== 'waiting' ? (
        <div className="group flex animate-fade-in items-center justify-between rounded-xl border border-border bg-surface-secondary/50 p-4 backdrop-blur-sm transition-colors hover:bg-surface-secondary dark:border-border-dark dark:bg-surface-dark-secondary/50 dark:hover:bg-surface-dark-secondary">
          <div className="flex items-center gap-3">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-success-100 dark:bg-success-900/30">
              <Check className="h-3.5 w-3.5 text-success-600 dark:text-success-400" />
            </div>
            <span className="text-xs font-medium text-text-primary dark:text-text-dark-primary">
              {config.labels.connected}
            </span>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={startDeviceFlow}
            className="h-7 text-xs text-text-tertiary hover:text-text-primary dark:text-text-dark-tertiary dark:hover:text-text-dark-primary"
          >
            Re-authenticate
          </Button>
        </div>
      ) : state === 'waiting' && !deviceInfo ? (
        <div className="flex h-[160px] animate-fade-in items-center justify-center rounded-xl border border-border bg-surface-secondary/30 dark:border-border-dark dark:bg-surface-dark-secondary/30">
          <Loader2 className="h-5 w-5 animate-spin text-text-tertiary dark:text-text-dark-tertiary" />
        </div>
      ) : state === 'waiting' && deviceInfo ? (
        <div className="animate-fade-in overflow-hidden rounded-xl border border-border bg-surface-secondary/50 shadow-medium backdrop-blur-sm dark:border-border-dark dark:bg-surface-dark-secondary/50">
          <div className="flex items-center justify-between border-b border-border bg-surface-tertiary/30 px-3 py-2 dark:border-border-dark dark:bg-surface-dark-tertiary/30">
            <div className="flex items-center gap-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-text-tertiary dark:text-text-dark-tertiary" />
              <span className="text-xs font-medium text-text-primary dark:text-text-dark-primary">
                Waiting for authorization...
              </span>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={cancelFlow}
              className="h-5 w-5 rounded-full p-0 text-text-tertiary opacity-70 hover:bg-surface-hover hover:text-text-primary hover:opacity-100 dark:text-text-dark-tertiary dark:hover:bg-surface-dark-hover dark:hover:text-text-dark-primary"
            >
              <X className="h-3 w-3" />
            </Button>
          </div>

          <div className="space-y-4 p-4">
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider text-text-tertiary dark:text-text-dark-tertiary">
                <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-surface-tertiary text-[9px] dark:bg-surface-dark-tertiary">
                  1
                </span>
                Visit URL
              </div>
              <a
                href={deviceInfo.uri}
                target="_blank"
                rel="noopener noreferrer"
                className="bg-surface-primary dark:bg-surface-dark-primary group flex w-full items-center justify-between rounded-md border border-border px-3 py-2 shadow-sm transition-colors hover:border-border-hover hover:bg-surface-hover hover:shadow-md dark:border-border-dark dark:hover:border-border-dark-hover dark:hover:bg-surface-dark-hover"
              >
                <span className="truncate font-mono text-xs text-text-primary underline decoration-text-quaternary underline-offset-4 group-hover:decoration-text-secondary dark:text-text-dark-primary dark:decoration-text-dark-quaternary dark:group-hover:decoration-text-dark-secondary">
                  {deviceInfo.uri}
                </span>
                <div className="flex items-center gap-1 text-2xs text-text-quaternary transition-colors group-hover:text-text-secondary dark:text-text-dark-quaternary dark:group-hover:text-text-dark-secondary">
                  <span className="hidden sm:inline">Open</span>
                  <ExternalLink className="h-3 w-3" />
                </div>
              </a>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider text-text-tertiary dark:text-text-dark-tertiary">
                <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-surface-tertiary text-[9px] dark:bg-surface-dark-tertiary">
                  2
                </span>
                Enter Code
              </div>
              <button
                type="button"
                onClick={() => void copyCode()}
                className="group relative w-full overflow-hidden rounded-md border border-border-secondary bg-surface-tertiary/30 py-3 text-center shadow-sm transition-colors hover:border-border-hover hover:bg-surface-tertiary hover:shadow-md active:scale-[0.99] dark:border-border-dark-secondary dark:bg-surface-dark-tertiary/30 dark:hover:border-border-dark-hover dark:hover:bg-surface-dark-tertiary"
              >
                <span className="font-mono text-xl font-bold tracking-[0.25em] text-text-primary transition-colors dark:text-text-dark-primary">
                  {deviceInfo.code}
                </span>
                <div className="bg-surface-primary/80 dark:bg-surface-dark-primary/80 absolute right-3 top-1/2 -translate-y-1/2 rounded p-1 opacity-0 backdrop-blur-sm transition-colors group-hover:opacity-100">
                  {copied ? (
                    <CheckCheck className="h-3.5 w-3.5 text-success-600 dark:text-success-400" />
                  ) : (
                    <Copy className="h-3.5 w-3.5 text-text-quaternary dark:text-text-dark-quaternary" />
                  )}
                </div>
              </button>
            </div>
          </div>
          <div className="h-0.5 w-full bg-surface-tertiary dark:bg-surface-dark-tertiary">
            <div
              className="h-full animate-progress-bar bg-text-secondary/20 dark:bg-text-dark-secondary/20"
              style={{ animationDuration: `${pollIntervalMs / 1000}s` }}
            />
          </div>
        </div>
      ) : (
        <div className="animate-fade-in space-y-1.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={startDeviceFlow}
            className="group w-full justify-between text-xs"
          >
            {config.labels.login}
            <ArrowRight className="h-3.5 w-3.5 opacity-50 transition-transform group-hover:translate-x-1" />
          </Button>
          {state === 'error' && errorMsg && (
            <p className="animate-fade-in px-1 text-2xs text-error-600 dark:text-error-400">
              {errorMsg}
            </p>
          )}
          <p className="px-1 text-2xs text-text-tertiary dark:text-text-dark-tertiary">
            {config.labels.helperText}
          </p>
        </div>
      )}
    </div>
  );
};
