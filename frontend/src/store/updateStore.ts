import { create } from 'zustand';

export type DesktopUpdateStatus = 'idle' | 'available' | 'downloading' | 'installing' | 'error';

interface DesktopUpdateState {
  status: DesktopUpdateStatus;
  version: string | null;
  currentVersion: string | null;
  releaseNotes: string | null;
  releaseDate: string | null;
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
      currentVersion: string;
      body: string | null;
      date: string | null;
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
  currentVersion: null,
  releaseNotes: null,
  releaseDate: null,
  downloadedBytes: 0,
  totalBytes: null,
  errorMessage: null,
  triggerInstall: null,
};

export const useDesktopUpdateStore = create<DesktopUpdateState & DesktopUpdateActions>((set) => ({
  ...initialState,
  setAvailable: ({ version, currentVersion, body, date }, triggerInstall) =>
    set({
      status: 'available',
      version,
      currentVersion,
      releaseNotes: body,
      releaseDate: date,
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
