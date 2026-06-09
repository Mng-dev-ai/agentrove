import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface CloudSettingsState {
  // VPS origin (e.g. https://vps.example.com), without the /api/v1 suffix.
  cloudUrl: string;
  // Email the desktop is connected to the VPS as — display only.
  connectedEmail: string | null;
  setCloud: (url: string, email: string) => void;
  clearCloud: () => void;
}

export const useCloudSettingsStore = create<CloudSettingsState>()(
  persist(
    (set) => ({
      cloudUrl: '',
      connectedEmail: null,
      setCloud: (url, email) => set({ cloudUrl: url, connectedEmail: email }),
      clearCloud: () => set({ cloudUrl: '', connectedEmail: null }),
    }),
    { name: 'cloud-settings-storage' },
  ),
);
