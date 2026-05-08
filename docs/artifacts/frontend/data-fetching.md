# Frontend Data Fetching

Read this **before adding a TanStack Query hook, a mutation, or any new API call.**

The codebase uses **TanStack Query 5** with a **hand-written `APIClient`** (`lib/api.ts`). All network reads go through query hooks; mutations go through `useMutation` (wrapped in `createMutation.ts`).

---

## Where things live

```
frontend/src/
├── lib/
│   ├── api.ts                  # APIClient (single instance: apiClient)
│   └── queryClient.ts          # QueryClient (staleTime 5m, gcTime 2m, retry 1)
├── hooks/queries/
│   ├── queryKeys.ts            # KEY FACTORY — read this before adding a hook
│   ├── createMutation.ts       # mutation wrapper
│   ├── useChatQueries.ts
│   ├── useAuthQueries.ts
│   ├── useSandboxQueries.ts
│   ├── useModelQueries.ts
│   ├── useGitHubQueries.ts
│   ├── useWorkspaceQueries.ts
│   ├── useSkillsQueries.ts
│   └── useSettingsQueries.ts
└── services/                   # domain services that wrap apiClient (chatService, sandboxService, ...)
```

---

## QueryClient defaults

`lib/queryClient.ts`:

- `staleTime: 5 * 60 * 1000` (5 min)
- `gcTime: 2 * 60 * 1000` (2 min)
- `retry: 1`
- `refetchOnWindowFocus: false`

Override per query when needed; don't change globally without discussion.

---

## Query key factory

`hooks/queries/queryKeys.ts` is the single source of truth for query keys. **Never inline a literal `['chats', id, ...]` array.** Always use the factory.

### Pattern

Hierarchical, with **prefix keys** for broad invalidation:

```ts
export const queryKeys = {
  chats: {
    all: ['chats'] as const,
    infinite: (perPage, workspaceId, pinned) => ['chats', 'infinite', perPage, workspaceId, pinned] as const,
    detail: (chatId) => ['chats', 'detail', chatId] as const,
  },
  sandbox: {
    gitBranchesAll: (sandboxId) => ['sandbox', sandboxId, 'git-branches'] as const,
    gitBranches: (sandboxId, cwd) => ['sandbox', sandboxId, 'git-branches', cwd] as const,
    fileContentAll: (sandboxId) => ['sandbox', sandboxId, 'file-content'] as const,
    fileContent: (sandboxId, cwd, path) => ['sandbox', sandboxId, 'file-content', cwd, path] as const,
  },
  // ...
};
```

### ⚠️ When a query key includes optional dimensions (e.g., `cwd`)

**Always add a separate prefix key** without the optional dimension for broad invalidation. Reason: `invalidateQueries` with `undefined` doesn't prefix-match real values.

- ❌ `invalidateQueries({ queryKey: queryKeys.sandbox.gitBranches(id, undefined) })` — misses cwd-scoped entries.
- ✅ `invalidateQueries({ queryKey: queryKeys.sandbox.gitBranchesAll(id) })` — prefix-matches all.

---

## Path-format consistency

When invalidating a key built from an identifier (file path, etc.), **verify the format matches consumers**. Cwd-relative vs. workspace-root-relative paths miss each other. When formats can diverge, invalidate a prefix key (e.g., `fileContentAll`).

---

## Hooks structure

A typical query hook:

```ts
export function useChat(chatId: string) {
  return useQuery({
    queryKey: queryKeys.chats.detail(chatId),
    queryFn: () => chatService.getChat(chatId),
    enabled: !!chatId,
  });
}
```

A typical mutation:

```ts
export const useCreateChat = createMutation({
  mutationFn: (input: CreateChatInput) => chatService.createChat(input),
  onSuccess: (chat, _input, { queryClient }) => {
    queryClient.invalidateQueries({ queryKey: queryKeys.chats.all });
  },
});
```

`createMutation.ts` wraps `useMutation` with toast-on-error and the `queryClient` injection — use it instead of raw `useMutation`.

---

## API client

`lib/api.ts` exports a single `apiClient` instance with:

- `apiClient.get<T>(path)` / `.post<T>(path, body)` / `.patch<T>(path, body)` / `.put<T>(path, body)` / `.delete(path)`
- `apiClient.postForm<T>(path, formData)` for multipart uploads
- `apiClient.getBlob(path)` for binary downloads
- Automatic 401 handling: deduped refresh-token flow; transparently retries the request once.
- Bearer token from `authStorage` (set in `authStore`).
- Desktop support: `setApiPort(port)` for Tauri sidecar.

**Don't `fetch()` directly.** Always go through `apiClient`. Don't add a new HTTP client library.

---

## Services layer (frontend)

`frontend/src/services/` wraps `apiClient` per domain:

- `chatService.ts`, `sandboxService.ts`, `workspaceService.ts`, `githubService.ts`, `skillService.ts`, `settingsService.ts`, `modelService.ts`, `permissionService.ts`, `queueService.ts`, `streamService.ts`, `authService.ts`, `desktopUpdateService.ts`.

Each service is a thin layer mapping typed input/output to `apiClient` calls. They **don't** hold state.

---

## Cwd propagation

Many sandbox/git operations are cwd-scoped. **Propagate `cwd` through the full chain**: backend endpoint → frontend service → React Query hook → UI component. Don't silently fall back to workspace root.

If you add a new cwd-scoped operation, also add the matching `*All(id)` prefix key for broad invalidation. (See `golden_principles.md` cross-cutting notes.)

---

## Streaming (SSE / WebSocket)

These don't go through `useQuery`. They use:

- `EventSourceResponse` (SSE) for chat streaming — `?chatId=...&messageId=...&seq=N` query params.
- WebSocket (`websocket.py` endpoint) for the terminal — first frame is auth JSON `{token: "..."}`.

The streaming integrations live in `services/streamService.ts` and write directly into TanStack Query cache via `queryClient.setQueryData(...)`. See `docs/domains/streaming.md`.

### Off-screen entities

For off-screen entities that need fresh state on next mount: **patch the cache optimistically during the stream/mutation** (`queryClient.setQueryData`). `invalidateQueries` alone isn't enough — `useQuery` serves cached data on mount during a background refetch.

---

## Invalidation patterns

- **Use `Promise.all()` for independent invalidations**: `await Promise.all([qc.invalidateQueries(...), qc.invalidateQueries(...)])`.
- **Cancelled runs still invalidate.** Terminal-kind gating (cancelled vs complete) applies only to UI-side concerns (notifications, toasts). Cache invalidations for server-side state mutated during the turn must run regardless. (See `golden_principles.md` cross-cutting notes.)

---

## Anti-patterns to refuse

- ❌ **Inlining query key arrays.** Use the factory.
- ❌ **`fetch()` directly.** Use `apiClient`.
- ❌ **Adding a new HTTP client (axios, ky, swr).** We use TanStack Query + `apiClient`.
- ❌ **Reading server data from Zustand or context.** TanStack Query is the source of truth.
- ❌ **`invalidateQueries` with `undefined` for an optional key dimension.** Use the prefix `*All(id)` factory entry.
- ❌ **Calling `useQuery` conditionally** (after early return).
- ❌ **`await Promise.all([])` with serialized work** — only if the calls are genuinely independent.

---

## When you're stuck — canonical examples

- Query factory: `frontend/src/hooks/queries/queryKeys.ts`
- Composed query (chat + infinite messages): `frontend/src/hooks/useChatData.ts`
- Mutation with cache invalidation: `frontend/src/hooks/queries/useChatQueries.ts`
- Cwd-scoped query and matching prefix key: search `gitBranchesAll` / `fileContentAll` in `queryKeys.ts`.

---

## Recent prior art

- **PR #432** — Fix off-screen stream cache writes targeting wrong chat. Read for: routing stream updates by `envelope.chatId` instead of hook-scoped IDs.
- **PR #429** — Fix stuck skeleton when switching between streaming chats. Read for: cache priming on mount.
- **PR #325** — Fix skeleton flash when switching between streaming chats.
- **PR #527** — Sync branch UI with HEAD on focus and agent turn end. Read for: invalidation timing tied to lifecycle events.
- **PR #560** — Add chat search across all workspaces. Read for: a fresh query/mutation pair shipped end-to-end.
