import type { LucideIcon } from 'lucide-react';
import {
  Settings2,
  UserCircle,
  Brain,
  Key,
  ScrollText,
  Clock,
  Cloud,
  GitBranch,
} from 'lucide-react';

export type TabKey =
  | 'general'
  | 'personas'
  | 'memory'
  | 'stream_actions'
  | 'automations'
  | 'env_vars'
  | 'instructions'
  | 'cloud';

export interface SettingsNavItem {
  id: TabKey;
  label: string;
  icon: LucideIcon;
}

export const SETTINGS_NAV: SettingsNavItem[] = [
  { id: 'general', label: 'General', icon: Settings2 },
  { id: 'personas', label: 'Personas', icon: UserCircle },
  { id: 'memory', label: 'Memory', icon: Brain },
  { id: 'stream_actions', label: 'Stream Actions', icon: GitBranch },
  { id: 'automations', label: 'Automations', icon: Clock },
  { id: 'env_vars', label: 'Env Variables', icon: Key },
  { id: 'instructions', label: 'Instructions', icon: ScrollText },
  { id: 'cloud', label: 'Cloud', icon: Cloud },
];

export const TAB_LABELS: Record<TabKey, string> = Object.fromEntries(
  SETTINGS_NAV.map((item) => [item.id, item.label]),
) as Record<TabKey, string>;
