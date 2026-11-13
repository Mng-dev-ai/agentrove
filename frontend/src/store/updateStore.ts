import { create } from 'zustand';

export type DesktopUpdateStatus = 'idle' | 'available' | 'downloading' | 'installing' | 'error';

interface DesktopUpdateState {
  status: DesktopUpdateStatus;
  version: string | null;
  releaseNotes: string | null;
  downloadedBytes: number;
  // null when the server omitted Content-Length
  totalBytes: number | null;
  errorMessage: string | null;
  triggerInstall: (() => Promise<void>) | null;
}

interface DesktopUpdateActions {
  setAvailable: (
    info: {
      version: string;
      body: string | null;
    },
    triggerInstall: () => Promise<void>,
  ) => void;
  setDownloading: () => void;
  setDownloadStarted: (totalBytes: number | null) => void;
  addDownloadChunk: (chunkLength: number) => void;
  setInstalling: () => void;
  setError: (message: string) => void;
}

const initialState: DesktopUpdateState = {
  status: 'idle',
  version: null,
  releaseNotes: null,
  downloadedBytes: 0,
  totalBytes: null,
  errorMessage: null,
  triggerInstall: null,
};

export const useDesktopUpdateStore = create<DesktopUpdateState & DesktopUpdateActions>((set) => ({
  ...initialState,
  setAvailable: ({ version, body }, triggerInstall) =>
    set({
      status: 'available',
      version,
      releaseNotes: body,
      downloadedBytes: 0,
      totalBytes: null,
      errorMessage: null,
      triggerInstall,
    }),
  setDownloading: () =>
    set({ status: 'downloading', downloadedBytes: 0, totalBytes: null, errorMessage: null }),
  setDownloadStarted: (totalBytes) => set({ totalBytes }),
  addDownloadChunk: (chunkLength) =>
    set((state) => ({ downloadedBytes: state.downloadedBytes + chunkLength })),
  setInstalling: () => set({ status: 'installing' }),
  setError: (message) => set({ status: 'error', errorMessage: message }),
}));
