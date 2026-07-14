import React from 'react';
import toast from 'react-hot-toast';
import type { NavigateFunction } from 'react-router-dom';
import type { QueryClient } from '@tanstack/react-query';
import {
  MessagesSquare,
  MessageSquarePlus,
  CodeXml,
  Terminal,
  GitBranch,
  PanelLeftClose,
  GitPullRequest,
  GitCommitHorizontal,
  ArrowUpFromLine,
  ArrowDownFromLine,
  Palette,
  Settings,
} from 'lucide-react';
import { useUIStore } from '@/store/uiStore';
import { useChatStore } from '@/store/chatStore';
import { sandboxService } from '@/services/sandboxService';
import { queryKeys } from '@/hooks/queries/queryKeys';
import { invalidateGitState } from '@/hooks/queries/useSandboxQueries';
import { isSecondaryPaneActive } from '@/utils/tileHelpers';
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
  requiresSandbox?: boolean;
}

export interface ActionCommandItem {
  type: 'action';
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  shortcut: string;
  hideOnMobile?: boolean;
  requiresChat?: boolean;
  requiresSandbox?: boolean;
}

export type CommandItem = ViewCommandItem | ActionCommandItem;

// Main-mode filter tabs; ⌘[/⌘] cycle through them in this order. Chats/Files match
// titles/filenames in the unified list; Messages/Grep host the content-search panels
// (chat messages / file contents) — named so they don't read as duplicates of Chats/Files.
export type MainFilter = 'all' | 'chats' | 'messages' | 'files' | 'grep' | 'actions';
export const MAIN_FILTERS: MainFilter[] = ['all', 'chats', 'messages', 'files', 'grep', 'actions'];

// Sub-modes (branch picker, theme picker) replace the whole menu surface; main
// filters only narrow the unified list or swap in a search panel.
export type MenuMode = MainFilter | 'branches' | 'themes';

export interface FlatFileItem {
  path: string;
  name: string;
}

// Loaded chat lists (instant title fuzzy match) normalized to one display shape;
// message-content search lives in the Messages tab, not here.
export interface ChatRowItem {
  id: string;
  title: string;
  workspaceName?: string;
}

// One flat list drives both keyboard navigation and rendering of the sectioned
// main-mode results, so their ordering can never diverge.
export type MenuListItem =
  | { kind: 'chat'; chat: ChatRowItem }
  | { kind: 'file'; file: FlatFileItem }
  | { kind: 'command'; command: CommandItem };

const VIEW_COMMANDS: ViewCommandItem[] = [
  { type: 'view', id: 'agent', label: 'Agent', icon: MessagesSquare, shortcut: 'a' },
  { type: 'view', id: 'editor', label: 'Editor', icon: CodeXml, shortcut: 'e' },
  { type: 'view', id: 'terminal', label: 'Terminal', icon: Terminal, shortcut: 't' },
  { type: 'view', id: 'diff', label: 'Diff', icon: GitBranch, shortcut: 'd' },
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
    requiresSandbox: true,
  },
  {
    type: 'action',
    id: 'push-remote',
    label: 'Push to remote',
    icon: ArrowUpFromLine,
    shortcut: 'u',
    requiresSandbox: true,
  },
  {
    type: 'action',
    id: 'pull-remote',
    label: 'Pull from remote',
    icon: ArrowDownFromLine,
    shortcut: 'j',
    requiresSandbox: true,
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
  // Opens the theme picker sub-mode (every theme as a list) instead of one command per
  // theme — keeps the chord space sane as themes grow.
  { type: 'action', id: 'set-theme', label: 'Set theme', icon: Palette, shortcut: 'm' },
  { type: 'action', id: 'open-settings', label: 'Settings', icon: Settings, shortcut: ',' },
];

export const ALL_COMMANDS: CommandItem[] = [
  ...ACTION_COMMANDS,
  ...SETTING_COMMANDS,
  ...VIEW_COMMANDS,
];

const PUNCTUATION_CODES: Record<string, string> = { '.': 'Period', ',': 'Comma' };

const shortcutToCode = (key: string) => PUNCTUATION_CODES[key] ?? `Key${key.toUpperCase()}`;

export const SHORTCUT_MAP = new Map<string, CommandItem>(
  ALL_COMMANDS.map((cmd) => [shortcutToCode(cmd.shortcut), cmd]),
);

// ⌘⇧<key> chords that jump straight to a filter tab — opening the menu on it when
// closed, switching tabs when open. 'all' is covered by the ⌘⇧P toggle. Keys must
// not collide with command shortcuts above.
export const FILTER_SHORTCUTS: Record<Exclude<MainFilter, 'all'>, string> = {
  chats: 'k',
  messages: 's',
  files: 'o',
  grep: 'f',
  actions: 'x',
};

export const FILTER_SHORTCUT_MAP = new Map<string, MainFilter>(
  (Object.entries(FILTER_SHORTCUTS) as [MainFilter, string][]).map(([filter, key]) => [
    shortcutToCode(key),
    filter,
  ]),
);

// Commands that switch the menu into a sub-mode instead of dispatching an action.
export const COMMAND_TO_MODE: Partial<Record<string, MenuMode>> = {
  'switch-branch': 'branches',
  'set-theme': 'themes',
};

export const flattenFiles = (files: FileStructure[]): FlatFileItem[] =>
  traverseFileStructure(files, (item) =>
    item.type === 'file' ? { path: item.path, name: getFileName(item.path) } : null,
  );

export function formatShortcut(key: string): string {
  const mod = IS_MAC_PLATFORM ? '⌘' : 'Ctrl';
  return `${mod}⇧${key === '.' ? '.' : key.toUpperCase()}`;
}

// The sandbox a git action targets. Resolved from the active pane's chat context
// (or the selected workspace on the landing page), decoupled from whether a chat exists.
export interface GitTarget {
  sandboxId?: string;
  worktreeCwd?: string;
}

// Chat-scoped actions (sub-threads) target the pane the user last interacted with —
// in split view the secondary pane is a different chat. The secondary chat is
// cache-warm here since it's rendered in the split.
function getActiveChat(queryClient: QueryClient): Chat | null {
  const ui = useUIStore.getState();
  if (isSecondaryPaneActive(ui.activeAgentTile, ui.secondaryChatId) && ui.secondaryChatId) {
    // Don't fall back to the primary chat — acting on the wrong chat is worse than
    // a no-op if the secondary chat isn't cached yet.
    return queryClient.getQueryData<Chat>(queryKeys.chat(ui.secondaryChatId)) ?? null;
  }
  return useChatStore.getState().currentChat;
}

// Git target for the global keyboard-shortcut path, which has no chat context.
// Prefers the active chat; on the landing page (no chat) it falls back to the
// selected workspace's sandbox so branch/pull/push shortcuts still resolve.
export function resolveActiveGitTarget(queryClient: QueryClient): GitTarget {
  const chat = getActiveChat(queryClient);
  if (chat?.sandbox_id) {
    return { sandboxId: chat.sandbox_id, worktreeCwd: chat.worktree_cwd ?? undefined };
  }
  return { sandboxId: useUIStore.getState().workspaceSandboxId ?? undefined };
}

function executeGitRemoteCommand(
  target: GitTarget,
  fn: (
    sandboxId: string,
    cwd?: string,
  ) => Promise<{ success: boolean; output: string; error?: string }>,
  label: string,
  onSuccess?: () => void,
) {
  if (!target.sandboxId) {
    toast.error('No sandbox connected');
    return;
  }
  void fn(target.sandboxId, target.worktreeCwd)
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
  gitTarget: GitTarget,
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
    const sandboxId = gitTarget.sandboxId;
    executeGitRemoteCommand(gitTarget, sandboxService.gitPush, 'Pushed to remote', () => {
      if (sandboxId) {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.sandbox.gitBranchesAll(sandboxId),
        });
      }
    });
  } else if (cmd.id === 'pull-remote') {
    const sandboxId = gitTarget.sandboxId;
    executeGitRemoteCommand(gitTarget, sandboxService.gitPull, 'Pulled from remote', () => {
      if (sandboxId) {
        void Promise.all([
          queryClient.invalidateQueries({
            queryKey: queryKeys.sandbox.gitBranchesAll(sandboxId),
          }),
          queryClient.invalidateQueries({
            queryKey: queryKeys.sandbox.filesMetadataAll(sandboxId),
          }),
          invalidateGitState(queryClient, sandboxId),
        ]);
      }
    });
  } else if (cmd.id === 'toggle-sidebar') {
    ui.setSidebarOpen(!ui.sidebarOpen);
  } else if (cmd.id === 'set-theme') {
    ui.setPendingMenuMode('themes');
    ui.setCommandMenuOpen(true);
  } else if (cmd.id === 'open-settings') {
    navigate('/settings');
  } else if (cmd.id === 'switch-branch') {
    if (!gitTarget.sandboxId) {
      toast.error('No sandbox connected');
      return;
    }
    // Bail out only if we know the repo state and it's unavailable; if the cache is cold,
    // let the menu open and fall through to its loading/empty states.
    const cached = queryClient.getQueryData<GitBranchesData>(
      queryKeys.sandbox.gitBranches(gitTarget.sandboxId, gitTarget.worktreeCwd),
    );
    if (cached && (!cached.is_git_repo || cached.branches.length === 0)) {
      toast.error('No git branches available');
      return;
    }
    ui.setPendingMenuMode('branches');
    ui.setCommandMenuOpen(true);
  }
}
