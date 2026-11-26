import { isTauri } from '@tauri-apps/api/core';

// Frontend Checks greps the minified pair `startsWith("MAC"),<id>=!0,`: keep these adjacent.
export const IS_MAC_PLATFORM = navigator.platform.toUpperCase().startsWith('MAC');

// Vite `--mode mobile` sets VITE_PLATFORM=mobile. No local sidecar — skip desktop boot.
const IS_MOBILE_BUILD = import.meta.env.VITE_PLATFORM === 'mobile';

// No isTauri() guard: browser `dev:mobile` stays testable; Tauri-only calls no-op.
export const isMobileApp = (): boolean => IS_MOBILE_BUILD;

export const isDesktopApp = (): boolean => isTauri() && !IS_MOBILE_BUILD;
