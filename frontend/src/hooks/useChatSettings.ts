import { useChatQuery } from '@/hooks/queries/useChatQueries';
import {
  useChatSettingsStore,
  DEFAULT_CHAT_SETTINGS_KEY,
  DEFAULT_PERMISSION_MODE,
  DEFAULT_THINKING_MODE,
  DEFAULT_PERSONA,
} from '@/store/chatSettingsStore';

export function useChatSettings(chatId: string | undefined) {
  const { data: chat } = useChatQuery(chatId);
  const key = chatId ?? DEFAULT_CHAT_SETTINGS_KEY;
  const permissionMode = useChatSettingsStore(
    (state) =>
      state.permissionModeByChat[key] ?? chat?.last_permission_mode ?? DEFAULT_PERMISSION_MODE,
  );
  const thinkingMode = useChatSettingsStore(
    (state) =>
      state.thinkingModeByChat[key] ??
      chat?.last_thinking_mode ??
      (chat?.last_model_id ? 'default' : DEFAULT_THINKING_MODE),
  );
  const persona = useChatSettingsStore(
    (state) => state.personaByChat[key] ?? chat?.last_persona_name ?? DEFAULT_PERSONA,
  );
  return { permissionMode, thinkingMode, persona };
}
