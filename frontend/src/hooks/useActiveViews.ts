import { useRef } from 'react';
import { useUIStore } from '@/store/uiStore';
import { getLeafViewTypes, tileIdToViewType } from '@/utils/mosaicHelpers';
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
    const { mosaicLayout, currentView } = state;
    let next: ViewType[];
    if (!mosaicLayout) {
      next = [currentView];
    } else if (typeof mosaicLayout === 'string') {
      next = [tileIdToViewType(mosaicLayout)];
    } else {
      next = getLeafViewTypes(mosaicLayout);
    }
    if (arraysEqual(prevRef.current, next)) return prevRef.current;
    prevRef.current = next;
    return next;
  });
}
