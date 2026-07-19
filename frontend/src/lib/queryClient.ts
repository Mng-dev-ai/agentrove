import { QueryClient, defaultShouldDehydrateQuery } from '@tanstack/react-query';
import type { Query } from '@tanstack/react-query';
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister';
import type { PersistQueryClientOptions } from '@tanstack/react-query-persist-client';
import { queryKeys } from '@/hooks/queries/queryKeys';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      gcTime: 1000 * 60 * 2, // 2 minutes
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

// First-paint only (chats, workspaces, user). Skip messages/diffs (quota) and settings (secrets).
function shouldPersistQuery(query: Query): boolean {
  if (!defaultShouldDehydrateQuery(query)) return false;
  const key = query.queryKey;
  if (key[0] === queryKeys.chats && key[1] === 'infinite') return true;
  if (key[0] === queryKeys.auth.user) return true;
  if (key.length === 1 && key[0] === queryKeys.workspaces[0]) return true;
  return key[0] === queryKeys.cloudChatsAll[0] && key[1] === queryKeys.cloudChatsAll[1];
}

export const persistOptions: Omit<PersistQueryClientOptions, 'queryClient'> = {
  persister: createSyncStoragePersister({
    storage: window.localStorage,
    key: 'agentrove-query-cache',
  }),
  dehydrateOptions: { shouldDehydrateQuery: shouldPersistQuery },
  // Bump on response-shape changes. v2 purges v1 that briefly cached settings (secrets).
  buster: 'v2',
};
