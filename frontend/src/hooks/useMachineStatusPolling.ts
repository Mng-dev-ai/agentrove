import { useEffect } from 'react';
import { useRemoteMachineIds } from '@/store/machineStore';
import { checkMachine } from '@/services/machineSession';

const POLL_INTERVAL_MS = 30_000;

export function useMachineStatusPolling(enabled: boolean): void {
  const key = useRemoteMachineIds().join('\n');

  useEffect(() => {
    if (!enabled || !key) return;
    const ids = key.split('\n');
    const checkAll = () => {
      if (document.visibilityState !== 'visible') return;
      for (const id of ids) void checkMachine(id);
    };
    checkAll();
    const timer = window.setInterval(checkAll, POLL_INTERVAL_MS);
    document.addEventListener('visibilitychange', checkAll);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', checkAll);
    };
  }, [enabled, key]);
}
