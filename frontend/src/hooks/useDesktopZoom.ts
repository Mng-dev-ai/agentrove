import { getCurrentWebview } from '@tauri-apps/api/webview';
import { useMountEffect } from '@/hooks/useMountEffect';
import { isDesktopApp } from '@/utils/platform';

const ZOOM_STORAGE_KEY = 'desktop-zoom';
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2;
const ZOOM_STEP = 0.1;

let currentZoom = 1;

function applyZoom(zoom: number) {
  // Round to one decimal so repeated ±0.1 steps don't accumulate float drift
  currentZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(zoom * 10) / 10));
  localStorage.setItem(ZOOM_STORAGE_KEY, String(currentZoom));
  getCurrentWebview()
    .setZoom(currentZoom)
    .catch((error) => console.error('Failed to set webview zoom:', error));
}

export function useDesktopZoom() {
  // Tauri has no built-in zoom; reapply stored level on mount.
  useMountEffect(() => {
    if (!isDesktopApp()) return;

    const stored = Number(localStorage.getItem(ZOOM_STORAGE_KEY));
    if (stored && stored !== 1) applyZoom(stored);

    function handler(e: KeyboardEvent) {
      const accel = e.metaKey || e.ctrlKey;
      if (!accel || e.altKey) return;
      // '+' covers Cmd+Shift+= on US layouts and numpad plus
      if (e.key === '=' || e.key === '+') {
        e.preventDefault();
        applyZoom(currentZoom + ZOOM_STEP);
      } else if (e.key === '-') {
        e.preventDefault();
        applyZoom(currentZoom - ZOOM_STEP);
      } else if (e.key === '0') {
        e.preventDefault();
        applyZoom(1);
      }
    }

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });
}
