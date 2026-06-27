import { useShallow } from 'zustand/react/shallow';
import { useUIStore } from '@/store/uiStore';
import { tileViewKinds } from '@/utils/tileHelpers';
import type { ViewType } from '@/types/ui.types';

// Derives the deduped list of on-screen view *kinds* (ViewType) from the visible
// tiles. Two agent panes collapse to a single 'agent' entry here — consumers that
// need per-tile awareness should read visibleLayout directly. useShallow keeps the
// result referentially stable while the kinds are unchanged.
export function useActiveViews(): ViewType[] {
  return useUIStore(useShallow((state) => tileViewKinds(state.visibleLayout.flat())));
}
