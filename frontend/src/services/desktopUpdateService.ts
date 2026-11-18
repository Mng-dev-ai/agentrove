import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { useDesktopUpdateStore, type DesktopUpdateState } from '@/store/updateStore';

// Events are the store's only writer: Rust emits them under its state lock, so they arrive in order.
export async function attachDesktopUpdate(): Promise<UnlistenFn> {
  const unlisten = await listen<DesktopUpdateState>('update-state', (event) => {
    useDesktopUpdateStore.getState().setUpdate(event.payload);
  });
  try {
    await invoke('update_check');
  } catch (error) {
    console.error('Desktop updater check failed:', error);
  }
  return unlisten;
}

export async function downloadDesktopUpdate(): Promise<void> {
  await invoke('update_download');
}

export async function installDesktopUpdate(): Promise<void> {
  await invoke('update_install');
}

export async function retryDesktopUpdate(): Promise<void> {
  const update = await invoke<DesktopUpdateState>('update_check');
  if (update.status === 'available') await downloadDesktopUpdate();
}
