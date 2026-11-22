import {
  useChatSettingsStore,
  DEFAULT_CHAT_SETTINGS_KEY,
  DEFAULT_FAST_MODE,
} from '@/store/chatSettingsStore';

export const FAST_MODE_OPTIONS = [
  { value: false as const, label: 'Normal' },
  { value: true as const, label: 'Fast' },
] as const;

export type FastModeOption = (typeof FAST_MODE_OPTIONS)[number];

export function useFastModeOption(chatId: string | undefined): FastModeOption {
  const key = chatId ?? DEFAULT_CHAT_SETTINGS_KEY;
  const fastMode = useChatSettingsStore((state) => state.fastModeByChat[key] ?? DEFAULT_FAST_MODE);
  return fastMode ? FAST_MODE_OPTIONS[1] : FAST_MODE_OPTIONS[0];
}
