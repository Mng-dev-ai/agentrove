import type { LucideIcon } from 'lucide-react';
import {
  Settings2,
  Bell,
  UserCircle,
  Brain,
  Key,
  ScrollText,
  Clock,
  GitBranch,
  Server,
  Smartphone,
  Palette,
} from 'lucide-react';
import { isTauri } from '@tauri-apps/api/core';

export type TabKey =
  | 'general'
  | 'appearance'
  | 'notifications'
  | 'personas'
  | 'memory'
  | 'stream_actions'
  | 'automations'
  | 'env_vars'
  | 'instructions'
  | 'machines'
  | 'devices';

export interface SettingsNavItem {
  id: TabKey;
  label: string;
  icon: LucideIcon;
}

export const SETTINGS_NAV: SettingsNavItem[] = [
  { id: 'general', label: 'General', icon: Settings2 },
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'personas', label: 'Personas', icon: UserCircle },
  { id: 'memory', label: 'Memory', icon: Brain },
  { id: 'stream_actions', label: 'Stream Actions', icon: GitBranch },
  { id: 'automations', label: 'Automations', icon: Clock },
  { id: 'env_vars', label: 'Env Variables', icon: Key },
  { id: 'instructions', label: 'Instructions', icon: ScrollText },
  { id: 'machines', label: 'Machines', icon: Server },
  ...(isTauri() ? [] : [{ id: 'devices' as const, label: 'Devices', icon: Smartphone }]),
];

export const TAB_LABELS: Record<TabKey, string> = Object.fromEntries(
  SETTINGS_NAV.map((item) => [item.id, item.label]),
) as Record<TabKey, string>;

const MOBILE_GROUP_IDS: { title: string; ids: TabKey[] }[] = [
  { title: 'App', ids: ['general', 'appearance', 'notifications'] },
  {
    title: 'Agents',
    ids: ['personas', 'instructions', 'automations', 'stream_actions', 'memory'],
  },
  { title: 'Infrastructure', ids: ['machines', 'devices', 'env_vars'] },
];

export const SETTINGS_GROUPS: { title: string; items: SettingsNavItem[] }[] = MOBILE_GROUP_IDS.map(
  ({ title, ids }) => ({
    title,
    items: ids.flatMap((id) => SETTINGS_NAV.find((item) => item.id === id) ?? []),
  }),
);
