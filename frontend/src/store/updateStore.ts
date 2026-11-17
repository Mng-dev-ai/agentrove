import { create } from 'zustand';

export type DesktopUpdateState =
  | { status: 'idle' }
  | { status: 'available'; version: string }
  // totalBytes is null when the server omitted Content-Length
  | { status: 'downloading'; downloadedBytes: number; totalBytes: number | null }
  | { status: 'ready'; version: string }
  | { status: 'installing' }
  | { status: 'error'; message: string };

interface DesktopUpdateStore {
  update: DesktopUpdateState;
  setUpdate: (update: DesktopUpdateState) => void;
}

export const useDesktopUpdateStore = create<DesktopUpdateStore>((set) => ({
  update: { status: 'idle' },
  setUpdate: (update) => set({ update }),
}));
