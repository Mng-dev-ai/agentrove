import { isTauri } from '@tauri-apps/api/core';

export const IS_MAC_PLATFORM = navigator.platform.toUpperCase().startsWith('MAC');

// Set at build time by Vite mode: `--mode mobile` loads .env.mobile which sets
// VITE_PLATFORM=mobile. Mobile builds run inside a Tauri shell (isTauri() is true)
// but have no local backend sidecar — they talk to a remote backend baked in at
// build time, so the desktop sidecar/updater/tray boot paths must be skipped.
const IS_MOBILE_BUILD = import.meta.env.VITE_PLATFORM === 'mobile';

export const isMobileApp = (): boolean => IS_MOBILE_BUILD;

export const isDesktopApp = (): boolean => isTauri() && !IS_MOBILE_BUILD;
