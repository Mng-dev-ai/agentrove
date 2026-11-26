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

function forgetChats(isForgotten: (chatId: string) => boolean): void {
  useUIStore.getState().cleanupChats(isForgotten);
  useChatSettingsStore.getState().cleanupChats(isForgotten);
  useModelStore.getState().cleanupChats(isForgotten);
  const queue = useMessageQueueStore.getState();
  for (const chatId of queue.queues.keys()) {
    if (isForgotten(chatId)) queue.cleanupChat(chatId);
  }
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

// A machine wipe keeps channels and their member chats; the caller lists those survivors.
export function forgetChatsForMachines(
  wipedMachineIds: ReadonlySet<string>,
  survivingIds: ReadonlySet<string>,
): void {
  forgetChats((id) => !survivingIds.has(id) && wipedMachineIds.has(ownerMachineId(id)));
}
