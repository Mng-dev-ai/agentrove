import { useState } from 'react';
import { useMountEffect } from '@/hooks/useMountEffect';

export function useFirstPaint(): boolean {
  // False for the mounting render, true right after first paint. Heavy views
  // return a fallback for that one render so a navigation's commit paints
  // immediately instead of blocking on their subtree; hooks above the early
  // return still run, so data fetching starts during the deferred frame.
  const [hasPainted, setHasPainted] = useState(false);
  useMountEffect(() => setHasPainted(true));
  return hasPainted;
}
