import { useEffect } from 'react';
import { logger } from '@/utils/logger';
import { registerActiveStreams } from '@/utils/activeStreams';
import { useCloudSettingsStore } from '@/store/cloudSettingsStore';
import { cloudChatService } from '@/services/cloudChatService';

// Restores active VPS streams in one bulk request — the cloud instance runs the
// same backend as local, so its registry-backed active-streams endpoint covers
// every chat and sub-thread without a per-chat status fan-out. Runs once per
// connection (keyed by cloudUrl); streams started while the app is open arrive
// live via useCloudChatEvents.
export function useCloudStreamRestoration({ enabled }: { enabled: boolean }) {
  const cloudUrl = useCloudSettingsStore((state) => state.cloudUrl);

  useEffect(() => {
    if (!enabled || !cloudUrl) return;

    // A cloudUrl switch mid-flight must not land the old instance's streams;
    // the re-run restores from the new instance instead.
    let cancelled = false;
    const restore = async () => {
      const active = await cloudChatService.getActiveStreams();
      if (cancelled) return;
      registerActiveStreams(active);
    };

    restore().catch((error) => {
      logger.error('Cloud stream restoration failed', 'useCloudStreamRestoration', error);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, cloudUrl]);
}
