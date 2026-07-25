import { useMountEffect } from '@/hooks/useMountEffect';
import { resetAppBadge } from '@/utils/notifications';

// Coming back to the app acknowledges the notifications useBackgroundNotify badged.
export function useAppBadge(): void {
  useMountEffect(() => {
    const controller = new AbortController();
    const clear = () => {
      if (document.visibilityState === 'visible') void resetAppBadge();
    };
    const options = { signal: controller.signal };
    window.addEventListener('focus', clear, options);
    document.addEventListener('visibilitychange', clear, options);
    return () => controller.abort();
  });
}
