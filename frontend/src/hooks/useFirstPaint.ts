import { useState } from 'react';
import { useMountEffect } from '@/hooks/useMountEffect';

export function useFirstPaint(): boolean {
  // False on mount, true after first paint — heavy views can fallback one frame so nav paints
  // immediately while hooks above the early-return still start fetches.
  const [hasPainted, setHasPainted] = useState(false);
  useMountEffect(() => setHasPainted(true));
  return hasPainted;
}
