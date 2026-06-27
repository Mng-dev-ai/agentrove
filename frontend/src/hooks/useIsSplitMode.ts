import { useUIStore } from '@/store/uiStore';

export function useIsSplitMode(): boolean {
  return useUIStore((state) => state.visibleLayout.flat().length > 1);
}
