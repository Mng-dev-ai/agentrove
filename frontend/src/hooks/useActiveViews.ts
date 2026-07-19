import { useShallow } from 'zustand/react/shallow';
import { useUIStore } from '@/store/uiStore';
import { tileViewKinds } from '@/utils/tileHelpers';
import type { ViewType } from '@/types/ui.types';

// Deduped on-screen ViewTypes (two agent panes → one 'agent'). useShallow for stable ref.
export function useActiveViews(): ViewType[] {
  return useUIStore(useShallow((state) => tileViewKinds(state.visibleLayout.flat())));
}
