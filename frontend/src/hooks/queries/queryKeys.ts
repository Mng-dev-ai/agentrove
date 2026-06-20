import type { DiffMode } from '@/types/sandbox.types';

export const queryKeys = {
  chats: 'chats',
  chatsSearch: (query: string) => ['chats', 'search', query] as const,
  chatsSearchAll: ['chats', 'search'] as const,
  chat: (chatId?: string) => ['chat', chatId] as const,
  messages: (chatId?: string) => ['messages', chatId] as const,
  contextUsage: (chatId?: string) => ['chat', chatId, 'context-usage'] as const,
  // chatId is the routing dimension (local vs cloud backend) — keep it in the key so a
  // message-keyed entry can't serve data fetched from the wrong backend under staleTime.
  messageChanges: (chatId?: string, messageId?: string) =>
    ['message', chatId, messageId, 'changes'] as const,
  messageFileDiff: (chatId?: string, messageId?: string, path?: string) =>
    ['message', chatId, messageId, 'changes', 'diff', path] as const,
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
    filesMetadata: (sandboxId?: string) => ['sandbox', sandboxId, 'files-metadata'] as const,
    secrets: (sandboxId?: string) => ['sandbox', sandboxId, 'secrets'] as const,
    gitDiff: (
      sandboxId: string | undefined,
      mode: DiffMode,
      fullContext: boolean = false,
      cwd?: string,
    ) => ['sandbox', sandboxId, 'git-diff', mode, fullContext, cwd] as const,
    gitDiffAll: (sandboxId?: string) => ['sandbox', sandboxId, 'git-diff'] as const,
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
  cloudChats: (cloudUrl?: string, connectedEmail?: string | null) =>
    ['cloud', 'chats', cloudUrl, connectedEmail] as const,
  // Prefix key for invalidating every cloud chats query regardless of instance/account.
  cloudChatsAll: ['cloud', 'chats'] as const,
  models: 'models',
  github: {
    repos: (query: string) => ['github-repos', query] as const,
    pulls: (owner: string, repo: string) => ['github-pulls', owner, repo] as const,
    collaborators: (owner: string, repo: string) => ['github-collaborators', owner, repo] as const,
  },
} as const;
