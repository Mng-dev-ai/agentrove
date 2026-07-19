import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { useDesktopUpdateStore } from '@/store/updateStore';

// Stage an available update without downloading (download only on user click).
export async function checkDesktopUpdate(): Promise<void> {
  const update = await check();
  if (!update) return;

  useDesktopUpdateStore.getState().setAvailable(
    {
      version: update.version,
      currentVersion: update.currentVersion,
      body: update.body ?? null,
      date: update.date ?? null,
    },
    () => downloadAndInstall(update),
  );
}

async function downloadAndInstall(update: Update): Promise<void> {
  const store = useDesktopUpdateStore.getState();
  store.setDownloading();
  try {
    await update.download((event) => {
      const s = useDesktopUpdateStore.getState();
      if (event.event === 'Started') {
        s.setDownloadStarted(event.data.contentLength ?? null);
      } else if (event.event === 'Progress') {
        s.addDownloadChunk(event.data.chunkLength);
      }
    });
    useDesktopUpdateStore.getState().setInstalling();
    await update.install();
    // Windows install() exits; macOS/Linux replace in place and need relaunch.
    await relaunch();
  } catch (error) {
    useDesktopUpdateStore
      .getState()
      .setError(error instanceof Error ? error.message : 'Update failed');
  }
}
