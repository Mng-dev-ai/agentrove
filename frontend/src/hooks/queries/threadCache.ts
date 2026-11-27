import type { InfiniteData, QueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/hooks/queries/queryKeys';
import { chatMachineId } from '@/store/machineOrigin';
import type { PaginatedChats } from '@/types/api.types';
import type { Channel } from '@/types/channel.types';
import { LOCAL_MACHINE_ID } from '@/types/machine.types';
import type { LastThread } from '@/types/ui.types';

const hasChat = (page: PaginatedChats, chatId: string) =>
  page.items.some((chat) => chat.id === chatId);

const withoutChat = (page: PaginatedChats, chatId: string): PaginatedChats => ({
  ...page,
  items: page.items.filter((chat) => chat.id !== chatId),
  total: Math.max(0, page.total - 1),
});

// Drops a thread that is gone (deleted here, or answering 404) from every cached list that
// could offer it, so nothing picks it before those lists refetch. A channel's nested
// position under its parent chat comes from the same channel lists.
export function evictThread(queryClient: QueryClient, { kind, id }: LastThread): void {
  if (kind === 'channel') {
    queryClient.setQueriesData<Channel[]>({ queryKey: queryKeys.channelsAll }, (channels) =>
      channels?.filter((channel) => channel.id !== id),
    );
    return;
  }
  queryClient.setQueriesData<InfiniteData<PaginatedChats>>(
    { queryKey: [queryKeys.chats, 'infinite'] },
    (data) =>
      data?.pages.some((page) => hasChat(page, id))
        ? { ...data, pages: data.pages.map((page) => withoutChat(page, id)) }
        : data,
  );
  const machineId = chatMachineId(id);
  if (machineId !== LOCAL_MACHINE_ID) {
    queryClient.setQueriesData<PaginatedChats>(
      { queryKey: queryKeys.machine.chatsPageAll(machineId) },
      (page) => (page && hasChat(page, id) ? withoutChat(page, id) : page),
    );
  }
}
