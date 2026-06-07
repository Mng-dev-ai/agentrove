import { useRef } from 'react';
import { useUIStore } from '@/store/uiStore';
import { getEffectiveLayout, getLeafViewTypes } from '@/utils/mosaicHelpers';
import type { ViewType } from '@/types/ui.types';

function arraysEqual(a: ViewType[], b: ViewType[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

// Derives the deduped list of visible view *kinds* (ViewType) from the mosaic
// layout. Two agent panes collapse to a single 'agent' entry here — consumers
// that need per-tile awareness should read mosaicLayout directly. Uses a ref
// to return a referentially stable array when the set hasn't changed.
export function useActiveViews(): ViewType[] {
  const prevRef = useRef<ViewType[]>([]);

  return useUIStore((state) => {
    const next = getLeafViewTypes(getEffectiveLayout(state.mosaicLayout, state.currentView));
    if (arraysEqual(prevRef.current, next)) return prevRef.current;
    prevRef.current = next;
    return next;
  });
}
