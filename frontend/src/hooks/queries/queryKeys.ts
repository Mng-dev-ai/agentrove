import type { PullRequestFilters } from '@/types/github.types';
import type { DiffMode } from '@/types/sandbox.types';

export const queryKeys = {
  chatAll: ['chat'] as const,
  chat: (chatId?: string) => ['chat', chatId] as const,
  messages: (chatId?: string) => ['messages', chatId] as const,
  messageRender: (messageId: string) => ['message-render', messageId] as const,
  contextUsage: (chatId?: string) => ['chat', chatId, 'context-usage'] as const,
  subThreads: (chatId?: string) => ['chat', chatId, 'sub-threads'] as const,
  auth: {
    user: 'auth-user',
  },
  sandbox: {
    fileContent: (sandboxId?: string, filePath?: string) =>
      ['sandbox', sandboxId, 'file-content', filePath] as const,
    fileContentAll: (sandboxId?: string) => ['sandbox', sandboxId, 'file-content'] as const,
    filesMetadata: (sandboxId?: string, cwd?: string) =>
      ['sandbox', sandboxId, 'files-metadata', cwd] as const,
    filesMetadataAll: (sandboxId?: string) => ['sandbox', sandboxId, 'files-metadata'] as const,
    gitDiff: (
      sandboxId: string | undefined,
      mode: DiffMode,
      fullContext: boolean = false,
      cwd?: string,
    ) => ['sandbox', sandboxId, 'git-diff', mode, fullContext, cwd] as const,
    gitDiffAll: (sandboxId?: string) => ['sandbox', sandboxId, 'git-diff'] as const,
    // Under the git-diff prefix so every gitDiffAll invalidation refreshes it.
    gitDiffStats: (sandboxId?: string, cwd?: string) =>
      ['sandbox', sandboxId, 'git-diff', 'stats', cwd] as const,
    gitFileBaseline: (sandboxId?: string, path?: string, cwd?: string) =>
      ['sandbox', sandboxId, 'git-file-baseline', path, cwd] as const,
    gitFileBaselineAll: (sandboxId?: string) =>
      ['sandbox', sandboxId, 'git-file-baseline'] as const,
    gitChangedPaths: (sandboxId?: string, cwd?: string) =>
      ['sandbox', sandboxId, 'git-changed-paths', cwd] as const,
    gitChangedPathsAll: (sandboxId?: string) =>
      ['sandbox', sandboxId, 'git-changed-paths'] as const,
    gitBranches: (sandboxId?: string, cwd?: string) =>
      ['sandbox', sandboxId, 'git-branches', cwd] as const,
    gitBranchesAll: (sandboxId?: string) => ['sandbox', sandboxId, 'git-branches'] as const,
    gitRemoteUrl: (sandboxId?: string, cwd?: string) =>
      ['sandbox', sandboxId, 'git-remote-url', cwd] as const,
    search: (
      sandboxId: string | undefined,
      query: string,
      cwd: string | undefined,
      caseSensitive: boolean = false,
      regex: boolean = false,
      wholeWord: boolean = false,
      include: string = '',
      exclude: string = '',
    ) =>
      [
        'sandbox',
        sandboxId,
        'search',
        query,
        cwd,
        caseSensitive,
        regex,
        wholeWord,
        include,
        exclude,
      ] as const,
  },
  machine: {
    all: (machineId: string) => ['machine', machineId] as const,
    instance: (machineId: string) => ['machine', machineId, 'instance'] as const,
    workspaces: (machineId: string) => ['machine', machineId, 'workspaces'] as const,
    workspaceResources: (machineId: string, workspaceId?: string) =>
      ['machine', machineId, 'workspaces', workspaceId, 'resources'] as const,
    settings: (machineId: string) => ['machine', machineId, 'settings'] as const,
    models: (machineId: string) => ['machine', machineId, 'models'] as const,
    chats: (machineId: string) => ['machine', machineId, 'chats'] as const,
    chatsInfiniteAll: (machineId: string) => ['machine', machineId, 'chats', 'infinite'] as const,
    chatsInfinite: (
      machineId: string,
      perPage: number,
      workspaceId: string,
      pinned: boolean | null,
    ) => ['machine', machineId, 'chats', 'infinite', perPage, workspaceId, pinned] as const,
    chatsRecent: (machineId: string) => ['machine', machineId, 'chats', 'recent'] as const,
    chatsSearch: (machineId: string, query: string) =>
      ['machine', machineId, 'chats', 'search', query] as const,
    chatsSearchAll: (machineId: string) => ['machine', machineId, 'chats', 'search'] as const,
    chatsPage: (machineId: string, page: number) =>
      ['machine', machineId, 'chats', 'page', page] as const,
    chatsTotal: (machineId: string) => ['machine', machineId, 'chats', 'total'] as const,
    activeStreams: (machineId: string) => ['machine', machineId, 'active-streams'] as const,
    automations: (machineId: string) => ['machine', machineId, 'automations'] as const,
    memories: (machineId: string, workspaceId: string | null) =>
      ['machine', machineId, 'memories', workspaceId] as const,
    memoriesAll: (machineId: string) => ['machine', machineId, 'memories'] as const,
    inbox: (machineId: string) => ['machine', machineId, 'inbox'] as const,
    rateLimits: (machineId: string) => ['machine', machineId, 'rate-limits'] as const,
  },
  channels: (machineId: string) => ['channels', machineId] as const,
  channelsAll: ['channels'] as const,
  channelAll: ['channel'] as const,
  channel: (channelId?: string) => ['channel', channelId] as const,
  channelMessageActivity: (channelId: string, messageId: string) =>
    ['channel', channelId, 'activity', messageId] as const,
  devices: ['devices'] as const,
  github: {
    repos: (query: string) => ['github-repos', query] as const,
    // Keyed by chatId because the response depends on which backend's GitHub
    // credentials served it (the machine that owns the chat).
    pullsAll: (owner: string, repo: string, chatId?: string) =>
      ['github-pulls', owner, repo, chatId ?? null] as const,
    pulls: (owner: string, repo: string, chatId?: string, filters?: PullRequestFilters) =>
      [...queryKeys.github.pullsAll(owner, repo, chatId), filters ?? {}] as const,
    collaborators: (owner: string, repo: string, chatId?: string) =>
      ['github-collaborators', owner, repo, chatId ?? null] as const,
  },
} as const;
