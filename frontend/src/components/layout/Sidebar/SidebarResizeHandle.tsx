import { useRef, useState } from 'react';
import {
  clampSidebarWidth,
  DEFAULT_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  useUIStore,
} from '@/store/uiStore';
import clsx from 'clsx';
import { stateClasses } from '@/config/stateClasses';
import styles from './SidebarResizeHandle.module.scss';

const KEYBOARD_STEP = 16;

export function SidebarResizeHandle() {
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef<{ startX: number; startWidth: number; latest: number } | null>(null);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const startWidth = useUIStore.getState().sidebarWidth;
    dragRef.current = { startX: e.clientX, startWidth, latest: startWidth };
    setIsDragging(true);
    document.body.style.cursor = 'col-resize';
    document.documentElement.style.setProperty('--sidebar-transition-duration', '0ms');

    const handleMove = (ev: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const next = clampSidebarWidth(drag.startWidth + (ev.clientX - drag.startX));
      drag.latest = next;
      // Bypass React during drag: write the CSS var directly so the browser
      // handles layout, with zero re-renders per frame.
      document.documentElement.style.setProperty('--sidebar-width', `${next}px`);
    };

    const cleanup = () => {
      const finalWidth = dragRef.current?.latest;
      dragRef.current = null;
      setIsDragging(false);
      document.body.style.cursor = '';
      document.documentElement.style.removeProperty('--sidebar-transition-duration');
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', cleanup);
      window.removeEventListener('pointercancel', cleanup);
      if (finalWidth !== undefined) useUIStore.getState().setSidebarWidth(finalWidth);
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', cleanup);
    window.addEventListener('pointercancel', cleanup);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const { sidebarWidth, setSidebarWidth } = useUIStore.getState();
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      setSidebarWidth(sidebarWidth - KEYBOARD_STEP);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      setSidebarWidth(sidebarWidth + KEYBOARD_STEP);
    } else if (e.key === 'Home') {
      e.preventDefault();
      setSidebarWidth(MIN_SIDEBAR_WIDTH);
    } else if (e.key === 'End') {
      e.preventDefault();
      setSidebarWidth(MAX_SIDEBAR_WIDTH);
    }
  };

  const sidebarWidth = useUIStore((s) => s.sidebarWidth);

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      aria-valuenow={sidebarWidth}
      aria-valuemin={MIN_SIDEBAR_WIDTH}
      aria-valuemax={MAX_SIDEBAR_WIDTH}
      aria-valuetext={`${sidebarWidth} pixels${
        sidebarWidth === DEFAULT_SIDEBAR_WIDTH ? ' (default)' : ''
      }`}
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onKeyDown={handleKeyDown}
      className={clsx(styles['resize-handle'], isDragging && stateClasses.DRAGGING)}
    />
  );
}
