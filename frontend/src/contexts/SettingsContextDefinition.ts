import { createContext } from 'react';
import type { UserSettings } from '@/types/user.types';

type PersistSettingsFn = (
  updater: (previous: UserSettings) => UserSettings,
  options?: { errorMessage?: string },
) => Promise<void>;

export interface SettingsContextValue {
  localSettings: UserSettings;
  setLocalSettings: React.Dispatch<React.SetStateAction<UserSettings>>;
  persistSettings: PersistSettingsFn;
  settings: UserSettings;
}

export const SettingsContext = createContext<SettingsContextValue | null>(null);
