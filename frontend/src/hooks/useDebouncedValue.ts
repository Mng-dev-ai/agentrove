import { useState, useEffect } from 'react';

// Debounced copy of a fast-changing string (search inputs). Empty values flush
// immediately so clearing a search resets results without waiting out the delay.
export function useDebouncedValue(value: string, delayMs: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    if (!value) {
      setDebounced(value);
      return;
    }
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}
