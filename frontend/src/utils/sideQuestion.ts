import { queryClient } from '@/lib/queryClient';
import { applyCreatedChat } from '@/hooks/queries/useChatQueries';
import { chatService } from '@/services/chatService';
import { ServiceError } from '@/services/base/ServiceError';
import type { PermissionMode } from '@/store/chatSettingsStore';
import { useUIStore } from '@/store/uiStore';
import { startChatTurn } from '@/utils/chatTurn';
import { AGENT_LABELS, type Chat, type Model } from '@/types/chat.types';
import type { SlashCommand } from '@/types/ui.types';

const SIDE_QUESTION_COMMAND = /^\s*\/btw(?:\s+([\s\S]*))?$/;
export const SIDE_QUESTION_SLASH_COMMAND: SlashCommand = {
  value: '/btw',
  label: 'Btw',
  description: 'Ask a side question without interrupting this turn',
};
const NO_FINISHED_REPLY = 'Side questions need at least one finished reply in this chat.';

export type SideQuestionIntent =
  | { kind: 'ask'; chat: Chat; model: Model; question: string }
  | { kind: 'refuse'; message: string }
  | { kind: 'empty' };

interface SideQuestionSettings {
  permissionMode: PermissionMode;
  thinkingMode: string;
  personaName: string;
}

interface SideQuestionInput {
  prompt: string;
  attachedFiles: File[] | null;
}

// The fork copies the agent's own session, so the chat must have run on that agent.
export function canForkChat(chat: Chat, chatModel: Model | undefined): boolean {
  return (
    !chat.channel_id &&
    !!chatModel?.supports_fork &&
    chat.session_agent_kind === chatModel.agent_kind
  );
}

export function canAskSideQuestion(chat: Chat | undefined, chatModel: Model | undefined): boolean {
  return !!chat && !chat.parent_chat_id && canForkChat(chat, chatModel);
}

export function sideQuestionIntent(
  text: string,
  chat: Chat | undefined,
  chatModel: Model | undefined,
): SideQuestionIntent | null {
  const match = SIDE_QUESTION_COMMAND.exec(text);
  if (!match) return null;
  const question = match[1]?.trim() ?? '';
  if (!question) return { kind: 'empty' };
  if (chat?.parent_chat_id) {
    return { kind: 'refuse', message: "Side questions aren't available inside a sub-thread." };
  }
  if (chatModel && !chatModel.supports_fork) {
    return {
      kind: 'refuse',
      message: `Side questions aren't available for ${AGENT_LABELS[chatModel.agent_kind]} yet.`,
    };
  }
  if (!chat || !chatModel || !canAskSideQuestion(chat, chatModel)) {
    return { kind: 'refuse', message: NO_FINISHED_REPLY };
  }
  return { kind: 'ask', chat, model: chatModel, question };
}

export function sideQuestionErrorMessage(error: unknown): string {
  if (error instanceof ServiceError && error.status === 409) return NO_FINISHED_REPLY;
  return error instanceof Error ? error.message : 'Failed to ask the side question';
}

export async function startSideQuestion(
  { chat, model, question }: Extract<SideQuestionIntent, { kind: 'ask' }>,
  { prompt, attachedFiles }: SideQuestionInput,
  fallback: SideQuestionSettings,
): Promise<void> {
  const sideChat = await chatService.forkChat(chat.id, {
    asSubThread: true,
    title: question.replace(/\s+/g, ' ').slice(0, 80),
  });
  await applyCreatedChat(queryClient, sideChat);
  useUIStore.getState().openSideQuestion(sideChat.id);
  await startChatTurn({
    prompt,
    chat_id: sideChat.id,
    model_id: sideChat.last_model_id ?? model.model_id,
    attached_files: attachedFiles ?? undefined,
    permission_mode: sideChat.last_permission_mode ?? fallback.permissionMode,
    thinking_mode: sideChat.last_thinking_mode ?? fallback.thinkingMode,
    selected_persona_name: sideChat.last_persona_name ?? fallback.personaName,
  });
}
