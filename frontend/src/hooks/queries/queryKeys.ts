import type { DiffMode } from '@/types/sandbox.types';

export const queryKeys = {
  chats: 'chats',
  chatsSearch: (query: string) => ['chats', 'search', query] as const,
  chatsSearchAll: ['chats', 'search'] as const,
  chat: (chatId?: string) => ['chat', chatId] as const,
  messages: (chatId?: string) => ['messages', chatId] as const,
  contextUsage: (chatId?: string) => ['chat', chatId, 'context-usage'] as const,
  messageChanges: (messageId?: string) => ['message', messageId, 'changes'] as const,
  messageFileDiff: (messageId?: string, path?: string) =>
    ['message', messageId, 'changes', 'diff', path] as const,
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
  workspaceResources: (workspaceId?: string) => ['workspaces', workspaceId, 'resources'] as const,
  cloudWorkspaces: (cloudUrl?: string, connectedEmail?: string | null) =>
    ['cloud', 'workspaces', cloudUrl, connectedEmail] as const,
  models: 'models',
  github: {
    repos: (query: string) => ['github-repos', query] as const,
    pulls: (owner: string, repo: string) => ['github-pulls', owner, repo] as const,
    collaborators: (owner: string, repo: string) => ['github-collaborators', owner, repo] as const,
  },
} as const;
