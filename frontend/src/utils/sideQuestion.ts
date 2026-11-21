import { queryClient } from '@/lib/queryClient';
import { applyCreatedChat } from '@/hooks/queries/useChatQueries';
import { chatService } from '@/services/chatService';
import { ServiceError } from '@/services/base/ServiceError';
import { useChatSettingsStore, type PermissionMode } from '@/store/chatSettingsStore';
import { useModelStore } from '@/store/modelStore';
import { useStreamStore } from '@/store/streamStore';
import { useUIStore } from '@/store/uiStore';
import { AGENT_LABELS, type AgentKind, type Chat } from '@/types/chat.types';

const SIDE_QUESTION_COMMAND = /^\s*\/btw(?:\s+([\s\S]*))?$/;
const NO_FINISHED_REPLY = 'Side questions need at least one finished reply in this chat.';

export type SideQuestionIntent =
  | { kind: 'ask'; chatId: string; question: string }
  | { kind: 'refuse'; message: string }
  | { kind: 'empty' };

interface SideQuestionContext {
  chatId: string | undefined;
  inSubThread: boolean;
  agentKind: AgentKind;
  supportsFork: boolean;
}

interface SideQuestionSettings {
  modelId: string;
  permissionMode: PermissionMode;
  thinkingMode: string;
  personaName: string;
}

export function isSideQuestion(chat: Chat | undefined): boolean {
  return !!chat?.parent_chat_id && chat.parent_chat_id === chat.forked_from_chat_id;
}

export function sideQuestionIntent(
  text: string,
  { chatId, inSubThread, agentKind, supportsFork }: SideQuestionContext,
): SideQuestionIntent | null {
  const match = SIDE_QUESTION_COMMAND.exec(text);
  if (!match) return null;
  const question = match[1]?.trim() ?? '';
  if (!question) return { kind: 'empty' };
  if (inSubThread) {
    return { kind: 'refuse', message: "Side questions aren't available inside a sub-thread." };
  }
  if (!supportsFork) {
    return {
      kind: 'refuse',
      message: `Side questions aren't available for ${AGENT_LABELS[agentKind]} yet.`,
    };
  }
  if (!chatId) return { kind: 'refuse', message: NO_FINISHED_REPLY };
  return { kind: 'ask', chatId, question };
}

export function sideQuestionErrorMessage(error: unknown): string {
  if (error instanceof ServiceError && error.status === 409) return NO_FINISHED_REPLY;
  return error instanceof Error ? error.message : 'Failed to ask the side question';
}

export async function startSideQuestion(
  parentChatId: string,
  question: string,
  settings: SideQuestionSettings,
): Promise<void> {
  const sideChat = await chatService.forkChat(
    parentChatId,
    question.replace(/\s+/g, ' ').slice(0, 80),
  );
  await applyCreatedChat(queryClient, sideChat);
  const modelId = sideChat.last_model_id ?? settings.modelId;
  useModelStore.getState().selectModel(sideChat.id, modelId);
  const chatSettings = useChatSettingsStore.getState();
  chatSettings.setPermissionMode(sideChat.id, settings.permissionMode);
  chatSettings.setThinkingMode(sideChat.id, settings.thinkingMode);
  chatSettings.setPersona(sideChat.id, settings.personaName);
  useUIStore.getState().openSideQuestion(sideChat.id);

  const { messageId } = await chatService.startCompletion({
    prompt: question,
    chat_id: sideChat.id,
    model_id: modelId,
    permission_mode: settings.permissionMode,
    thinking_mode: settings.thinkingMode,
    selected_persona_name: settings.personaName,
  });
  useStreamStore.getState().addStreamMetadata({
    chatId: sideChat.id,
    messageId,
    startTime: Date.now(),
  });
}
