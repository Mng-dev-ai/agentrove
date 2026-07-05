import { useState } from 'react';
import { MOBILE_BREAKPOINT } from '@/config/constants';
import { useMountEffect } from '@/hooks/useMountEffect';

export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(
    typeof window !== 'undefined' ? window.innerWidth < MOBILE_BREAKPOINT : false,
  );

  useMountEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    };

    window.addEventListener('resize', handleResize, { passive: true });
    // Re-check after attaching: a resize between the initial render and this
    // effect (e.g. Tauri sizing the window during startup) is otherwise missed
    // forever, leaving the sidebar stuck in mobile overlay mode on desktop.
    handleResize();
    return () => window.removeEventListener('resize', handleResize);
  });

  return isMobile;
}
