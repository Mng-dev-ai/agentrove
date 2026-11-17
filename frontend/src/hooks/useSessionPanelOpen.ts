import { useUIStore } from '@/store/uiStore';
import { useIsMobile } from '@/hooks/useIsMobile';

export function useSessionPanelOpen(): boolean {
  const isMobile = useIsMobile();
  return useUIStore((s) => (isMobile ? s.mobileSessionPanelOpen : s.sessionPanelOpen));
}
