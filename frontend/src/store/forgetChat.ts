import { useChatSettingsStore } from '@/store/chatSettingsStore';
import {
  channelMachineId,
  chatMachineId,
  forgetChatOrigins,
  sandboxMachineId,
} from '@/store/machineOrigin';
import { useMessageQueueStore } from '@/store/messageQueueStore';
import { useModelStore } from '@/store/modelStore';
import { useUIStore } from '@/store/uiStore';
import { LOCAL_MACHINE_ID } from '@/types/machine.types';
import { LANDING_TERMINAL_SCOPE_PREFIX } from '@/utils/terminal';

interface SurvivingChannel {
  id: string;
  anchor_chat_id: string;
  members: { chat_id: string }[];
  former_members?: { chat_id: string }[];
}

function forgetChats(isForgotten: (chatId: string) => boolean): void {
  useUIStore.getState().cleanupChats(isForgotten);
  useChatSettingsStore.getState().cleanupChats(isForgotten);
  useModelStore.getState().cleanupChats(isForgotten);
  useMessageQueueStore.getState().cleanupChats(isForgotten);
  // Last: a machine-scoped isForgotten reads the origins this removes.
  forgetChatOrigins(isForgotten);
}

// Per-chat state is keyed by chat id, channel id (workspace layout) or landing terminal scope.
function ownerMachineId(scope: string): string {
  if (scope.startsWith(LANDING_TERMINAL_SCOPE_PREFIX)) {
    return sandboxMachineId(scope.slice(LANDING_TERMINAL_SCOPE_PREFIX.length));
  }
  const machineId = chatMachineId(scope);
  return machineId === LOCAL_MACHINE_ID ? channelMachineId(scope) : machineId;
}

export function forgetChat(chatId: string): void {
  forgetChats((id) => id === chatId);
}

// A machine wipe keeps channels and their member chats.
export function forgetChatsForMachine(
  machineId: string,
  survivingChannels: SurvivingChannel[],
): void {
  const survivingIds = new Set(
    survivingChannels.flatMap((channel) => [
      channel.id,
      channel.anchor_chat_id,
      ...[...channel.members, ...(channel.former_members ?? [])].map((member) => member.chat_id),
    ]),
  );
  forgetChats((id) => !survivingIds.has(id) && ownerMachineId(id) === machineId);
}
