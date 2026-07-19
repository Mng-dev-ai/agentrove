import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface CloudSettingsState {
  // VPS origin without /api/v1 (e.g. https://vps.example.com).
  cloudUrl: string;
  // Display-only connected email.
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
