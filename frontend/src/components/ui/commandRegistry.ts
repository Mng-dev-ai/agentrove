import React from 'react';
import toast from 'react-hot-toast';
import type { NavigateFunction } from 'react-router-dom';
import type { QueryClient } from '@tanstack/react-query';
import {
  MessagesSquare,
  MessageSquarePlus,
  Code,
  SquareTerminal,
  KeyRound,
  GitCompareArrows,
  GitBranch,
  Monitor,
  Search,
  PanelLeftClose,
  Moon,
  Sun,
  FileSearch,
  GitPullRequest,
  GitCommitHorizontal,
  ArrowUpFromLine,
  ArrowDownFromLine,
  MessageSquare,
} from 'lucide-react';
import { useUIStore } from '@/store/uiStore';
import { useChatStore } from '@/store/chatStore';
import { sandboxService } from '@/services/sandboxService';
import { queryKeys } from '@/hooks/queries/queryKeys';
import { isSecondaryPaneActive } from '@/utils/mosaicHelpers';
import { traverseFileStructure, getFileName } from '@/utils/file';
import { IS_MAC_PLATFORM } from '@/utils/platform';
import type { ViewType } from '@/types/ui.types';
import type { Chat } from '@/types/chat.types';
import type { FileStructure } from '@/types/file-system.types';
import type { GitBranchesData } from '@/types/sandbox.types';

export interface ViewCommandItem {
  type: 'view';
  id: ViewType;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  shortcut: string;
  hideOnMobile?: boolean;
  requiresChat?: boolean;
}

export interface ActionCommandItem {
  type: 'action';
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  shortcut: string;
  hideOnMobile?: boolean;
  requiresChat?: boolean;
}

export type CommandItem = ViewCommandItem | ActionCommandItem;

export type MenuMode = 'commands' | 'files' | 'branches' | 'search' | 'chat-search';

export interface FlatFileItem {
  path: string;
  name: string;
}

const VIEW_COMMANDS: ViewCommandItem[] = [
  { type: 'view', id: 'agent', label: 'Agent', icon: MessagesSquare, shortcut: 'a' },
  { type: 'view', id: 'editor', label: 'Editor', icon: Code, shortcut: 'e' },
  {
    type: 'view',
    id: 'terminal',
    label: 'Terminal',
    icon: SquareTerminal,
    shortcut: 't',
    requiresChat: true,
  },
  {
    type: 'view',
    id: 'diff',
    label: 'Diff',
    icon: GitCompareArrows,
    shortcut: 'd',
    requiresChat: true,
  },
  { type: 'view', id: 'secrets', label: 'Secrets', icon: KeyRound, shortcut: 's' },
];

const ACTION_COMMANDS: ActionCommandItem[] = [
  { type: 'action', id: 'new-thread', label: 'New thread', icon: MessageSquarePlus, shortcut: 'w' },
  {
    type: 'action',
    id: 'new-sub-thread',
    label: 'New sub-thread',
    icon: GitBranch,
    shortcut: 'n',
    requiresChat: true,
  },
  {
    type: 'action',
    id: 'create-commit',
    label: 'Create commit',
    icon: GitCommitHorizontal,
    shortcut: 'c',
    requiresChat: true,
  },
  {
    type: 'action',
    id: 'create-pr',
    label: 'Create pull request',
    icon: GitPullRequest,
    shortcut: 'l',
    requiresChat: true,
  },
  {
    type: 'action',
    id: 'create-branch',
    label: 'Create branch',
    icon: GitBranch,
    shortcut: 'h',
    requiresChat: true,
  },
  {
    type: 'action',
    id: 'switch-branch',
    label: 'Switch branch',
    icon: GitBranch,
    shortcut: 'b',
    requiresChat: true,
  },
  {
    type: 'action',
    id: 'push-remote',
    label: 'Push to remote',
    icon: ArrowUpFromLine,
    shortcut: 'u',
    requiresChat: true,
  },
  {
    type: 'action',
    id: 'pull-remote',
    label: 'Pull from remote',
    icon: ArrowDownFromLine,
    shortcut: 'j',
    requiresChat: true,
  },
];

const SETTING_COMMANDS: ActionCommandItem[] = [
  {
    type: 'action',
    id: 'toggle-sidebar',
    label: 'Toggle sidebar',
    icon: PanelLeftClose,
    shortcut: '.',
  },
  { type: 'action', id: 'theme-dark', label: 'Theme: Dark', icon: Moon, shortcut: 'm' },
  { type: 'action', id: 'theme-light', label: 'Theme: Light', icon: Sun, shortcut: 'g' },
  { type: 'action', id: 'theme-system', label: 'Theme: System', icon: Monitor, shortcut: 'y' },
  { type: 'action', id: 'search-in-files', label: 'Search in files', icon: Search, shortcut: 'f' },
  {
    type: 'action',
    id: 'search-in-chats',
    label: 'Search in chats',
    icon: MessageSquare,
    shortcut: 'k',
  },
  { type: 'action', id: 'go-to-file', label: 'Go to file', icon: FileSearch, shortcut: 'o' },
];

export const ALL_COMMANDS: CommandItem[] = [
  ...ACTION_COMMANDS,
  ...SETTING_COMMANDS,
  ...VIEW_COMMANDS,
];

export const SHORTCUT_MAP = new Map<string, CommandItem>(
  ALL_COMMANDS.map((cmd) => [
    cmd.shortcut === '.' ? 'Period' : `Key${cmd.shortcut.toUpperCase()}`,
    cmd,
  ]),
);

// Commands that switch the menu into a sub-mode instead of dispatching an action.
export const COMMAND_TO_MODE: Partial<Record<string, MenuMode>> = {
  'search-in-files': 'search',
  'search-in-chats': 'chat-search',
  'go-to-file': 'files',
  'switch-branch': 'branches',
};

export const flattenFiles = (files: FileStructure[]): FlatFileItem[] =>
  traverseFileStructure(files, (item) =>
    item.type === 'file' ? { path: item.path, name: getFileName(item.path) } : null,
  );

export function formatShortcut(key: string): string {
  const mod = IS_MAC_PLATFORM ? '⌘' : 'Ctrl';
  return `${mod}⇧${key === '.' ? '.' : key.toUpperCase()}`;
}

// Chat-scoped actions (git, sub-threads) target the pane the user last interacted
// with — in split view the secondary pane is a different chat. The secondary chat
// is cache-warm here since it's rendered in the split.
function getActiveChat(queryClient: QueryClient): Chat | null {
  const ui = useUIStore.getState();
  if (isSecondaryPaneActive(ui.activeAgentTile, ui.secondaryChatId) && ui.secondaryChatId) {
    // Don't fall back to the primary chat — acting on the wrong chat is worse than
    // a no-op if the secondary chat isn't cached yet.
    return queryClient.getQueryData<Chat>(queryKeys.chat(ui.secondaryChatId)) ?? null;
  }
  return useChatStore.getState().currentChat;
}

function executeGitRemoteCommand(
  chat: Chat | null,
  fn: (
    sandboxId: string,
    cwd?: string,
  ) => Promise<{ success: boolean; output: string; error?: string }>,
  label: string,
  onSuccess?: () => void,
) {
  if (!chat?.sandbox_id) {
    toast.error('No sandbox connected');
    return;
  }
  void fn(chat.sandbox_id, chat.worktree_cwd ?? undefined)
    .then((r) => {
      if (r.success) {
        toast.success(`${label}${r.output ? `: ${r.output.slice(0, 80)}` : ''}`);
        onSuccess?.();
      } else {
        toast.error(r.error || `${label} failed`);
      }
    })
    .catch(() => toast.error(`${label} failed`));
}

export function executeCommand(
  cmd: CommandItem,
  queryClient: QueryClient,
  navigate: NavigateFunction,
  toggle: boolean,
) {
  const ui = useUIStore.getState();

  if (cmd.type === 'view') {
    // Toggling is scoped to the active pane (the chat the user last interacted with).
    ui.toggleView(cmd.id, toggle);
  } else if (cmd.id === 'new-thread') {
    navigate('/');
  } else if (cmd.id === 'new-sub-thread') {
    const chat = getActiveChat(queryClient);
    if (!chat || chat.parent_chat_id) {
      toast.error('Open a top-level thread first');
    } else {
      ui.setSubThreadDialogOpen(toggle ? !ui.subThreadDialogOpen : true);
    }
  } else if (cmd.id === 'create-commit') {
    ui.setCreateCommitDialogOpen(toggle ? !ui.createCommitDialogOpen : true);
  } else if (cmd.id === 'create-pr') {
    ui.setCreatePRDialogOpen(toggle ? !ui.createPRDialogOpen : true);
  } else if (cmd.id === 'create-branch') {
    ui.setCreateBranchDialogOpen(toggle ? !ui.createBranchDialogOpen : true);
  } else if (cmd.id === 'push-remote') {
    const chat = getActiveChat(queryClient);
    const sandboxId = chat?.sandbox_id;
    executeGitRemoteCommand(chat, sandboxService.gitPush, 'Pushed to remote', () => {
      if (sandboxId) {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.sandbox.gitBranchesAll(sandboxId),
        });
      }
    });
  } else if (cmd.id === 'pull-remote') {
    const chat = getActiveChat(queryClient);
    const sandboxId = chat?.sandbox_id;
    executeGitRemoteCommand(chat, sandboxService.gitPull, 'Pulled from remote', () => {
      if (sandboxId) {
        void Promise.all([
          queryClient.invalidateQueries({
            queryKey: queryKeys.sandbox.gitBranchesAll(sandboxId),
          }),
          queryClient.invalidateQueries({
            queryKey: queryKeys.sandbox.filesMetadata(sandboxId),
          }),
          queryClient.invalidateQueries({ queryKey: queryKeys.sandbox.gitDiffAll(sandboxId) }),
        ]);
      }
    });
  } else if (cmd.id === 'toggle-sidebar') {
    ui.setSidebarOpen(!ui.sidebarOpen);
  } else if (cmd.id.startsWith('theme-')) {
    ui.setTheme(cmd.id.slice(6) as 'dark' | 'light' | 'system');
  } else if (cmd.id === 'search-in-files') {
    ui.setPendingMenuMode('search');
    ui.setCommandMenuOpen(true);
  } else if (cmd.id === 'search-in-chats') {
    ui.setPendingMenuMode('chat-search');
    ui.setCommandMenuOpen(true);
  } else if (cmd.id === 'go-to-file') {
    ui.setPendingMenuMode('files');
    ui.setCommandMenuOpen(true);
  } else if (cmd.id === 'switch-branch') {
    const chat = getActiveChat(queryClient);
    if (!chat?.sandbox_id) {
      toast.error('No sandbox connected');
      return;
    }
    // Bail out only if we know the repo state and it's unavailable; if the cache is cold,
    // let the menu open and fall through to its loading/empty states.
    const cached = queryClient.getQueryData<GitBranchesData>(
      queryKeys.sandbox.gitBranches(chat.sandbox_id, chat.worktree_cwd ?? undefined),
    );
    if (cached && (!cached.is_git_repo || cached.branches.length === 0)) {
      toast.error('No git branches available');
      return;
    }
    ui.setPendingMenuMode('branches');
    ui.setCommandMenuOpen(true);
  }
}
