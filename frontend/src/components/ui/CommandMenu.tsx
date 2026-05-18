import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Button } from '@/components/ui/primitives/Button';
import { Input } from '@/components/ui/primitives/Input';
import { createPortal } from 'react-dom';
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
  PanelRight,
  PanelBottom,
  GitPullRequest,
  GitCommitHorizontal,
  Inbox,
  ArrowUpFromLine,
  ArrowDownFromLine,
  PanelLeftClose,
  Moon,
  Sun,
  FileSearch,
  File,
  MessageSquare,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useNavigate, type NavigateFunction } from 'react-router-dom';
import { useUIStore } from '@/store/uiStore';
import { useChatStore } from '@/store/chatStore';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { sandboxService } from '@/services/sandboxService';
import { queryKeys } from '@/hooks/queries/queryKeys';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useActiveViews } from '@/hooks/useActiveViews';
import { useChatContext } from '@/hooks/useChatContext';
import { useGitBranchesQuery, useCheckoutBranchMutation } from '@/hooks/queries/useSandboxQueries';
import { fuzzySearch } from '@/utils/fuzzySearch';
import { getLeafViewTypes, viewTypeToPrimaryTile } from '@/utils/mosaicHelpers';
import { traverseFileStructure, getFileName } from '@/utils/file';
import { HighlightMatch } from '@/components/ui/shared/HighlightMatch';
import { SearchPanel } from '@/components/editor/file-search/SearchPanel';
import { ChatSearchPanel } from '@/components/chat/chat-search/ChatSearchPanel';
import { cn } from '@/utils/cn';
import type { ViewType, MosaicDirection } from '@/types/ui.types';
import type { FileStructure } from '@/types/file-system.types';
import type { GitBranchesData } from '@/types/sandbox.types';

const rowClass = cn(
  'flex w-full items-center gap-3 px-3 py-2 text-xs transition-colors duration-200',
  'text-text-primary dark:text-text-dark-primary',
);

const splitButtonClass = cn(
  'flex items-center justify-center rounded-md p-1',
  'text-text-quaternary dark:text-text-dark-quaternary',
  'hover:text-text-primary dark:hover:text-text-dark-primary',
  'hover:bg-surface-hover dark:hover:bg-surface-dark-hover',
  'transition-colors duration-200',
);

interface ViewCommandItem {
  type: 'view';
  id: ViewType;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  shortcut: string;
  hideOnMobile?: boolean;
  requiresChat?: boolean;
}

interface ActionCommandItem {
  type: 'action';
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  shortcut: string;
  hideOnMobile?: boolean;
  requiresChat?: boolean;
}

type CommandItem = ViewCommandItem | ActionCommandItem;

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
  {
    type: 'view',
    id: 'prReview',
    label: 'PR Review Inbox',
    icon: Inbox,
    shortcut: 'i',
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
  {
    type: 'action',
    id: 'theme-dark',
    label: 'Theme: Dark',
    icon: Moon,
    shortcut: 'm',
  },
  {
    type: 'action',
    id: 'theme-light',
    label: 'Theme: Light',
    icon: Sun,
    shortcut: 'g',
  },
  {
    type: 'action',
    id: 'theme-system',
    label: 'Theme: System',
    icon: Monitor,
    shortcut: 'y',
  },
  {
    type: 'action',
    id: 'search-in-files',
    label: 'Search in files',
    icon: Search,
    shortcut: 'f',
  },
  {
    type: 'action',
    id: 'search-in-chats',
    label: 'Search in chats',
    icon: MessageSquare,
    shortcut: 'k',
  },
  {
    type: 'action',
    id: 'go-to-file',
    label: 'Go to file',
    icon: FileSearch,
    shortcut: 'o',
  },
];

const ALL_COMMANDS: CommandItem[] = [...ACTION_COMMANDS, ...SETTING_COMMANDS, ...VIEW_COMMANDS];

export const SHORTCUT_MAP = new Map<string, CommandItem>(
  ALL_COMMANDS.map((cmd) => [
    cmd.shortcut === '.' ? 'Period' : `Key${cmd.shortcut.toUpperCase()}`,
    cmd,
  ]),
);

type MenuMode = 'commands' | 'files' | 'branches' | 'search' | 'chat-search';

// Commands that switch the menu into a sub-mode instead of dispatching an action.
const COMMAND_TO_MODE: Partial<Record<string, MenuMode>> = {
  'search-in-files': 'search',
  'search-in-chats': 'chat-search',
  'go-to-file': 'files',
  'switch-branch': 'branches',
};

let pendingMenuMode: MenuMode | null = null;

interface FlatFileItem {
  path: string;
  name: string;
}

const flattenFiles = (files: FileStructure[]): FlatFileItem[] =>
  traverseFileStructure(files, (item) =>
    item.type === 'file' ? { path: item.path, name: getFileName(item.path) } : null,
  );

const IS_MAC = navigator.platform.toUpperCase().startsWith('MAC');

function formatShortcut(key: string): string {
  const mod = IS_MAC ? '⌘' : 'Ctrl';
  return `${mod}⇧${key === '.' ? '.' : key.toUpperCase()}`;
}

function executeGitRemoteCommand(
  fn: (
    sandboxId: string,
    cwd?: string,
  ) => Promise<{ success: boolean; output: string; error?: string }>,
  label: string,
  onSuccess?: () => void,
) {
  const chat = useChatStore.getState().currentChat;
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
    const layout = ui.mosaicLayout ?? viewTypeToPrimaryTile(ui.currentView);
    const leafKinds = getLeafViewTypes(layout);
    if (toggle && leafKinds.includes(cmd.id)) {
      if (cmd.id === 'agent' && ui.secondaryChatId) {
        ui.closeSplitChat();
      } else {
        ui.removeTileFromMosaic(viewTypeToPrimaryTile(cmd.id));
      }
    } else {
      ui.handleViewClick(cmd.id, true);
    }
  } else if (cmd.id === 'new-thread') {
    navigate('/');
  } else if (cmd.id === 'new-sub-thread') {
    const chat = useChatStore.getState().currentChat;
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
    const sandboxId = useChatStore.getState().currentChat?.sandbox_id;
    executeGitRemoteCommand(sandboxService.gitPush, 'Pushed to remote', () => {
      if (sandboxId) {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.sandbox.gitBranchesAll(sandboxId),
        });
      }
    });
  } else if (cmd.id === 'pull-remote') {
    const sandboxId = useChatStore.getState().currentChat?.sandbox_id;
    executeGitRemoteCommand(sandboxService.gitPull, 'Pulled from remote', () => {
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
    pendingMenuMode = 'search';
    ui.setCommandMenuOpen(true);
  } else if (cmd.id === 'search-in-chats') {
    pendingMenuMode = 'chat-search';
    ui.setCommandMenuOpen(true);
  } else if (cmd.id === 'go-to-file') {
    pendingMenuMode = 'files';
    ui.setCommandMenuOpen(true);
  } else if (cmd.id === 'switch-branch') {
    const chat = useChatStore.getState().currentChat;
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
    pendingMenuMode = 'branches';
    ui.setCommandMenuOpen(true);
  }
}

export function CommandMenu() {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [mode, setMode] = useState<MenuMode>('commands');
  const inputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const chatSearchInputRef = useRef<HTMLInputElement>(null);
  const previousFocusRef = useRef<Element | null>(null);
  const activeItemRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef({ activeIndex: 0, mode: 'commands' as MenuMode });
  const filteredFilesRef = useRef<FlatFileItem[]>([]);
  const filteredCommandsRef = useRef<CommandItem[]>([]);
  const filteredBranchesRef = useRef<string[]>([]);
  const listLengthRef = useRef(0);
  const listId = 'command-menu-list';

  const isOpen = useUIStore((state) => state.commandMenuOpen);
  const theme = useUIStore((state) => state.theme);
  const isMobile = useIsMobile();
  const activeLeaves = useActiveViews();
  const activeLeafSet = useMemo(() => new Set(activeLeaves), [activeLeaves]);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { fileStructure, sandboxId, chatId } = useChatContext();
  const worktreeCwd = useChatStore((s) => s.currentChat?.worktree_cwd) ?? undefined;

  // Fetch branches whenever the menu is open so we can both render the branches mode and
  // filter the switch-branch command out of the list for chats without a repo. Cache is
  // usually warm from BranchSelector so this rarely triggers a real fetch.
  const { data: branchesData } = useGitBranchesQuery(sandboxId, isOpen && !!sandboxId, worktreeCwd);
  const checkoutBranch = useCheckoutBranchMutation();

  const canSwitchBranch = !!branchesData?.is_git_repo && branchesData.branches.length > 0;

  const flatFiles = useMemo(() => flattenFiles(fileStructure), [fileStructure]);

  const filteredFiles = useMemo(
    () =>
      mode !== 'files'
        ? []
        : query.trim()
          ? fuzzySearch(query, flatFiles, { keys: ['name', 'path'], limit: 30 })
          : flatFiles.slice(0, 30),
    [query, flatFiles, mode],
  );

  const visibleCommands = useMemo(
    () =>
      ALL_COMMANDS.filter((cmd) => {
        if (isMobile && cmd.hideOnMobile) return false;
        if (cmd.requiresChat && !chatId) return false;
        if (cmd.id === 'switch-branch' && !canSwitchBranch) return false;
        return true;
      }),
    [isMobile, canSwitchBranch, chatId],
  );

  const filteredCommands = useMemo(
    () =>
      mode !== 'commands'
        ? []
        : fuzzySearch(query, visibleCommands, { keys: ['label'], limit: 20 }),
    [query, visibleCommands, mode],
  );

  const orderedBranches = useMemo(() => {
    if (!branchesData) return [];
    const current = branchesData.current_branch;
    const others = branchesData.branches.filter((b) => b !== current);
    return current ? [current, ...others] : others;
  }, [branchesData]);

  const filteredBranches = useMemo(
    () => (mode !== 'branches' ? [] : fuzzySearch(query, orderedBranches, { limit: 30 })),
    [mode, query, orderedBranches],
  );

  const listLength =
    mode === 'files'
      ? filteredFiles.length
      : mode === 'branches'
        ? filteredBranches.length
        : filteredCommands.length;

  const switchMode = useCallback((next: MenuMode) => {
    setMode(next);
    setQuery('');
    setActiveIndex(0);
    if (next === 'search') {
      // SearchPanel owns its own input; focus it after React flushes the mode change.
      requestAnimationFrame(() => searchInputRef.current?.focus());
    } else if (next === 'chat-search') {
      requestAnimationFrame(() => chatSearchInputRef.current?.focus());
    } else {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      previousFocusRef.current = document.activeElement;
      // switchMode also focuses the right input for the target mode.
      switchMode(pendingMenuMode ?? 'commands');
      pendingMenuMode = null;
    } else if (previousFocusRef.current instanceof HTMLElement) {
      previousFocusRef.current.focus();
      previousFocusRef.current = null;
    }
  }, [isOpen, switchMode]);

  const close = useCallback(() => {
    useUIStore.getState().setCommandMenuOpen(false);
  }, []);

  const handleSelectItem = useCallback(
    (cmd: CommandItem) => {
      executeCommand(cmd, queryClient, navigate, false);
      close();
    },
    [close, queryClient, navigate],
  );

  const handleSelectFile = useCallback(
    (file: FlatFileItem) => {
      useUIStore.getState().openFileInEditor(file.path);
      close();
    },
    [close],
  );

  const handleOpenSearchResult = useCallback(
    (path: string, lineNumber: number) => {
      useUIStore.getState().openFileInEditor(path, lineNumber);
      close();
    },
    [close],
  );

  const handleOpenChatResult = useCallback(
    (chatId: string) => {
      navigate(`/chat/${chatId}`);
      close();
    },
    [close, navigate],
  );

  const handleSelectBranch = useCallback(
    (branch: string) => {
      if (!sandboxId) {
        toast.error('No sandbox connected');
        return;
      }
      if (branch === branchesData?.current_branch) {
        close();
        return;
      }
      checkoutBranch.mutate(
        { sandboxId, branch, cwd: worktreeCwd },
        {
          onSuccess: (data) => {
            if (data.success) {
              toast.success(`Switched to ${branch}`);
            } else {
              toast.error(data.error ?? 'Failed to switch branch');
            }
          },
          onError: (err) => {
            toast.error(err instanceof Error ? err.message : 'Failed to switch branch');
          },
        },
      );
      close();
    },
    [sandboxId, worktreeCwd, branchesData, checkoutBranch, close],
  );

  const handleSplit = useCallback(
    (viewId: ViewType, direction: MosaicDirection) => {
      useUIStore.getState().addTileToMosaic(viewId, direction);
      close();
    },
    [close],
  );

  stateRef.current.activeIndex = activeIndex;
  stateRef.current.mode = mode;
  filteredFilesRef.current = filteredFiles;
  filteredCommandsRef.current = filteredCommands;
  filteredBranchesRef.current = filteredBranches;
  listLengthRef.current = listLength;

  useEffect(() => {
    activeItemRef.current?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const { activeIndex: idx, mode: m } = stateRef.current;
      const len = listLengthRef.current;

      if (m === 'search' || m === 'chat-search') {
        // The embedded panel handles its own typing + click-to-open; don't
        // hijack Enter/arrows here. Only wire Escape to step back to commands.
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopImmediatePropagation();
          switchMode('commands');
        }
        return;
      }

      switch (e.key) {
        case 'Escape':
          e.preventDefault();
          e.stopImmediatePropagation();
          if (m === 'files' || m === 'branches') {
            switchMode('commands');
          } else {
            close();
          }
          break;
        case 'ArrowDown':
          e.preventDefault();
          if (len > 0) {
            setActiveIndex((prev) => (prev + 1) % len);
          }
          break;
        case 'ArrowUp':
          e.preventDefault();
          if (len > 0) {
            setActiveIndex((prev) => (prev - 1 + len) % len);
          }
          break;
        case 'Enter':
          e.preventDefault();
          if (m === 'files') {
            const file = filteredFilesRef.current[idx];
            if (file) handleSelectFile(file);
          } else if (m === 'branches') {
            const branch = filteredBranchesRef.current[idx];
            if (branch) handleSelectBranch(branch);
          } else {
            const cmd = filteredCommandsRef.current[idx];
            if (cmd) {
              const nextMode = COMMAND_TO_MODE[cmd.id];
              if (nextMode) switchMode(nextMode);
              else handleSelectItem(cmd);
            }
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true });
  }, [isOpen, handleSelectItem, handleSelectFile, handleSelectBranch, switchMode, close]);

  if (!isOpen) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex justify-center"
      onClick={close}
      role="dialog"
      aria-modal="true"
      aria-label="Command menu"
    >
      <div
        className={cn(
          'mt-20 h-fit w-full',
          // Widen for search mode so code snippets don't wrap; keep the compact
          // dialog for every other mode.
          mode === 'search' || mode === 'chat-search' ? 'max-w-2xl' : 'max-w-md',
          'rounded-xl border border-border/50 shadow-strong dark:border-border-dark/50',
          'bg-surface/95 backdrop-blur-xl dark:bg-surface-dark/95',
          'animate-fade-in',
        )}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        {mode === 'search' ? (
          <>
            <div className="flex items-center gap-2 border-b border-border/50 px-3 py-2 dark:border-border-dark/50">
              <Button
                variant="unstyled"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => switchMode('commands')}
                className="shrink-0 rounded-md bg-surface-hover px-1.5 py-0.5 text-2xs font-medium text-text-secondary dark:bg-surface-dark-hover dark:text-text-dark-secondary"
              >
                Search in files
              </Button>
              <span className="text-2xs text-text-quaternary dark:text-text-dark-quaternary">
                Esc to go back
              </span>
            </div>
            <div className="h-[28rem]">
              <SearchPanel
                sandboxId={sandboxId ?? undefined}
                cwd={worktreeCwd}
                onOpenResult={handleOpenSearchResult}
                inputRef={searchInputRef}
              />
            </div>
          </>
        ) : mode === 'chat-search' ? (
          <>
            <div className="flex items-center gap-2 border-b border-border/50 px-3 py-2 dark:border-border-dark/50">
              <Button
                variant="unstyled"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => switchMode('commands')}
                className="shrink-0 rounded-md bg-surface-hover px-1.5 py-0.5 text-2xs font-medium text-text-secondary dark:bg-surface-dark-hover dark:text-text-dark-secondary"
              >
                Search in chats
              </Button>
              <span className="text-2xs text-text-quaternary dark:text-text-dark-quaternary">
                Esc to go back
              </span>
            </div>
            <div className="h-[28rem]">
              <ChatSearchPanel onOpenChat={handleOpenChatResult} inputRef={chatSearchInputRef} />
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2 border-b border-border/50 px-3 dark:border-border-dark/50">
              {(mode === 'files' || mode === 'branches') && (
                <Button
                  variant="unstyled"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => switchMode('commands')}
                  className="shrink-0 rounded-md bg-surface-hover px-1.5 py-0.5 text-2xs font-medium text-text-secondary dark:bg-surface-dark-hover dark:text-text-dark-secondary"
                >
                  {mode === 'files' ? 'Files' : 'Branches'}
                </Button>
              )}
              <Search className="h-3.5 w-3.5 shrink-0 text-text-tertiary dark:text-text-dark-tertiary" />
              <Input
                ref={inputRef}
                variant="unstyled"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActiveIndex(0);
                }}
                placeholder={
                  mode === 'files'
                    ? 'Search files...'
                    : mode === 'branches'
                      ? 'Search branches...'
                      : 'Search...'
                }
                className="h-10 w-full bg-transparent text-sm text-text-primary outline-none placeholder:text-text-quaternary dark:text-text-dark-primary dark:placeholder:text-text-dark-quaternary"
                role="combobox"
                aria-expanded="true"
                aria-controls={listId}
                aria-activedescendant={
                  mode === 'files'
                    ? filteredFiles[activeIndex]
                      ? `file-item-${activeIndex}`
                      : undefined
                    : mode === 'branches'
                      ? filteredBranches[activeIndex]
                        ? `branch-item-${activeIndex}`
                        : undefined
                      : filteredCommands[activeIndex]
                        ? `command-item-${filteredCommands[activeIndex].id}`
                        : undefined
                }
              />
            </div>

            <div className="max-h-64 overflow-y-auto py-1" role="listbox" id={listId}>
              {mode === 'files' ? (
                <>
                  {filteredFiles.map((file, index) => (
                    <div
                      key={file.path}
                      ref={index === activeIndex ? activeItemRef : undefined}
                      className={cn(
                        rowClass,
                        index === activeIndex
                          ? 'bg-surface-active dark:bg-surface-dark-active'
                          : 'hover:bg-surface-hover dark:hover:bg-surface-dark-hover',
                      )}
                      onMouseEnter={() => setActiveIndex(index)}
                    >
                      <Button
                        variant="unstyled"
                        id={`file-item-${index}`}
                        role="option"
                        aria-selected={index === activeIndex}
                        className="flex flex-1 items-center gap-3 overflow-hidden"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => handleSelectFile(file)}
                      >
                        <File className="h-3.5 w-3.5 shrink-0 text-text-tertiary dark:text-text-dark-tertiary" />
                        <span className="truncate">
                          <HighlightMatch
                            text={file.name}
                            searchQuery={query}
                            className="font-medium"
                          />
                          <span className="ml-2 text-text-quaternary dark:text-text-dark-quaternary">
                            {file.path}
                          </span>
                        </span>
                      </Button>
                    </div>
                  ))}
                  {filteredFiles.length === 0 && (
                    <p className="px-3 py-4 text-center text-xs text-text-quaternary dark:text-text-dark-quaternary">
                      No matching files
                    </p>
                  )}
                </>
              ) : mode === 'branches' ? (
                <>
                  {filteredBranches.map((branch, index) => {
                    const isCurrent = branch === branchesData?.current_branch;
                    return (
                      <div
                        key={branch}
                        ref={index === activeIndex ? activeItemRef : undefined}
                        className={cn(
                          rowClass,
                          index === activeIndex
                            ? 'bg-surface-active dark:bg-surface-dark-active'
                            : 'hover:bg-surface-hover dark:hover:bg-surface-dark-hover',
                        )}
                        onMouseEnter={() => setActiveIndex(index)}
                      >
                        <Button
                          variant="unstyled"
                          id={`branch-item-${index}`}
                          role="option"
                          aria-selected={index === activeIndex}
                          className="flex flex-1 items-center gap-3 overflow-hidden"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => handleSelectBranch(branch)}
                          disabled={checkoutBranch.isPending}
                        >
                          <GitBranch className="h-3.5 w-3.5 shrink-0 text-text-tertiary dark:text-text-dark-tertiary" />
                          <HighlightMatch
                            text={branch}
                            searchQuery={query}
                            className="flex-1 truncate text-left font-mono"
                          />
                          {isCurrent && (
                            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-text-primary dark:bg-text-dark-primary" />
                          )}
                        </Button>
                      </div>
                    );
                  })}
                  {filteredBranches.length === 0 && (
                    <p className="px-3 py-4 text-center text-xs text-text-quaternary dark:text-text-dark-quaternary">
                      {!sandboxId
                        ? 'No sandbox connected'
                        : !branchesData
                          ? 'Loading branches…'
                          : !branchesData.is_git_repo
                            ? 'Not a git repository'
                            : branchesData.branches.length === 0
                              ? 'No branches in this repository'
                              : 'No matching branches'}
                    </p>
                  )}
                </>
              ) : (
                <>
                  {filteredCommands.map((cmd, index) => {
                    const Icon = cmd.icon;
                    const isActive =
                      (cmd.type === 'view' && activeLeafSet.has(cmd.id)) ||
                      cmd.id === `theme-${theme}`;

                    return (
                      <div
                        key={cmd.id}
                        ref={index === activeIndex ? activeItemRef : undefined}
                        className={cn(
                          rowClass,
                          index === activeIndex
                            ? 'bg-surface-active dark:bg-surface-dark-active'
                            : 'hover:bg-surface-hover dark:hover:bg-surface-dark-hover',
                        )}
                        onMouseEnter={() => setActiveIndex(index)}
                      >
                        <Button
                          variant="unstyled"
                          id={`command-item-${cmd.id}`}
                          role="option"
                          aria-selected={index === activeIndex}
                          className="flex flex-1 items-center gap-3"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => {
                            const nextMode = COMMAND_TO_MODE[cmd.id];
                            if (nextMode) switchMode(nextMode);
                            else handleSelectItem(cmd);
                          }}
                        >
                          <Icon className="h-3.5 w-3.5 shrink-0 text-text-tertiary dark:text-text-dark-tertiary" />
                          <HighlightMatch
                            text={cmd.label}
                            searchQuery={query}
                            className="flex-1 text-left"
                          />
                          {isActive && (
                            <span className="h-1.5 w-1.5 rounded-full bg-text-primary dark:bg-text-dark-primary" />
                          )}
                        </Button>
                        {!isMobile && cmd.shortcut && (
                          <kbd className="ml-auto shrink-0 font-mono text-2xs text-text-quaternary dark:text-text-dark-quaternary">
                            {formatShortcut(cmd.shortcut)}
                          </kbd>
                        )}
                        {cmd.type === 'view' && !isMobile && !isActive && (
                          <div className="flex items-center gap-0.5">
                            <Button
                              variant="unstyled"
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => handleSplit(cmd.id, 'row')}
                              className={splitButtonClass}
                              title="Split right"
                            >
                              <PanelRight className="h-3 w-3" />
                            </Button>
                            <Button
                              variant="unstyled"
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => handleSplit(cmd.id, 'column')}
                              className={splitButtonClass}
                              title="Split down"
                            >
                              <PanelBottom className="h-3 w-3" />
                            </Button>
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {filteredCommands.length === 0 && (
                    <p className="px-3 py-4 text-center text-xs text-text-quaternary dark:text-text-dark-quaternary">
                      No matching commands
                    </p>
                  )}
                </>
              )}
            </div>

            {!isMobile && (
              <div className="flex items-center justify-between border-t border-border/50 px-3 py-2 dark:border-border-dark/50">
                <span className="text-2xs text-text-quaternary dark:text-text-dark-quaternary">
                  {mode === 'files'
                    ? '↵ Open file · Esc to go back'
                    : mode === 'branches'
                      ? '↵ Switch branch · Esc to go back'
                      : '↵ Select · Split via icons · Shortcuts work globally · Esc to close'}
                </span>
              </div>
            )}
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
