import type { DiffMode } from '@/types/sandbox.types';

export const queryKeys = {
  chats: 'chats',
  chatsSearch: (query: string) => ['chats', 'search', query] as const,
  chatsSearchAll: ['chats', 'search'] as const,
  chatsRecent: ['chats', 'recent'] as const,
  chat: (chatId?: string) => ['chat', chatId] as const,
  messages: (chatId?: string) => ['messages', chatId] as const,
  contextUsage: (chatId?: string) => ['chat', chatId, 'context-usage'] as const,
  subThreads: (chatId?: string) => ['chat', chatId, 'sub-threads'] as const,
  auth: {
    user: 'auth-user',
  },
  settings: 'settings',
  skills: 'skills',
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
    searchAll: (sandboxId?: string) => ['sandbox', sandboxId, 'search'] as const,
  },
  workspaces: ['workspaces'] as const,
  workspaceResources: (workspaceId?: string, chatId?: string) =>
    ['workspaces', workspaceId, 'resources', chatId] as const,
  cloudWorkspaces: (cloudUrl?: string, connectedEmail?: string | null) =>
    ['cloud', 'workspaces', cloudUrl, connectedEmail] as const,
  cloudWorkspaceResources: (
    cloudUrl?: string,
    connectedEmail?: string | null,
    workspaceId?: string,
  ) => ['cloud', 'workspaces', cloudUrl, connectedEmail, 'resources', workspaceId] as const,
  cloudSettings: (cloudUrl?: string, connectedEmail?: string | null) =>
    ['cloud', 'settings', cloudUrl, connectedEmail] as const,
  cloudChats: (cloudUrl?: string, connectedEmail?: string | null) =>
    ['cloud', 'chats', cloudUrl, connectedEmail] as const,
  cloudActiveStreams: (cloudUrl?: string, connectedEmail?: string | null) =>
    ['cloud', 'active-streams', cloudUrl, connectedEmail] as const,
  // Prefix key for invalidating every cloud chats query regardless of instance/account.
  cloudChatsAll: ['cloud', 'chats'] as const,
  automations: ['automations'] as const,
  cloudAutomations: (cloudUrl?: string, connectedEmail?: string | null) =>
    ['cloud', 'automations', cloudUrl, connectedEmail] as const,
  models: 'models',
  github: {
    repos: (query: string) => ['github-repos', query] as const,
    // Keyed by chatId because the response depends on which backend's GitHub
    // credentials served it (local vs the chat-owning cloud VPS).
    pulls: (owner: string, repo: string, chatId?: string) =>
      ['github-pulls', owner, repo, chatId ?? null] as const,
    collaborators: (owner: string, repo: string, chatId?: string) =>
      ['github-collaborators', owner, repo, chatId ?? null] as const,
  },
} as const;
