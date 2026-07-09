import {
  Fragment,
  useState,
  useEffect,
  useRef,
  useMemo,
  useCallback,
  type ReactNode,
  type Ref,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { Button } from '@/components/ui/primitives/Button/Button';
import { Input } from '@/components/ui/primitives/Input/Input';
import { FloatingTooltip } from '@/components/ui/FloatingTooltip';
import { createPortal } from 'react-dom';
import { GitBranch, Search, PanelRight, PanelBottom, File, MessageSquare } from 'lucide-react';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';
import { useUIStore } from '@/store/uiStore';
import { useAuthStore } from '@/store/authStore';
import { useQueryClient } from '@tanstack/react-query';
import { useIsMobile } from '@/hooks/useIsMobile';
import { isSecondaryPaneActive, viewTypeToTileId } from '@/utils/tileHelpers';
import { useChatContext } from '@/hooks/useChatContext';
import { useActiveChat } from '@/hooks/useActiveChat';
import { useSandboxFiles } from '@/hooks/useSandboxFiles';
import { useGitBranchesQuery, useCheckoutBranchMutation } from '@/hooks/queries/useSandboxQueries';
import { useWorkspacesList } from '@/hooks/queries/useWorkspaceQueries';
import { useSidebarChatLists } from '@/hooks/queries/useSidebarChatLists';
import { useSearchChatsQuery } from '@/hooks/queries/useChatQueries';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { fuzzySearch } from '@/utils/fuzzySearch';
import { HighlightMatch } from '@/components/ui/shared/HighlightMatch';
import { SearchPanel } from '@/components/editor/file-search/SearchPanel';
import { ChatSearchPanel } from '@/components/chat/chat-search/ChatSearchPanel';
import { cn } from '@/utils/cn';
import { THEMES, type ThemeMeta } from '@/utils/theme';
import { IS_MAC_PLATFORM } from '@/utils/platform';
import type { ViewType, SplitDirection, Theme } from '@/types/ui.types';
import {
  ALL_COMMANDS,
  COMMAND_TO_MODE,
  MAIN_FILTERS,
  executeCommand,
  flattenFiles,
  formatShortcut,
  type CommandItem,
  type FlatFileItem,
  type MainFilter,
  type MenuMode,
} from './commandRegistry';

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

const sectionHeaderClass = cn(
  'px-3 pb-1 pt-2 text-2xs font-medium uppercase tracking-wider',
  'text-text-quaternary dark:text-text-dark-quaternary',
);

const FILTER_LABELS: Record<MainFilter, string> = {
  all: 'All',
  chats: 'Chats',
  files: 'Files',
  actions: 'Actions',
};

const isMainMode = (mode: MenuMode): mode is MainFilter =>
  mode === 'all' || mode === 'chats' || mode === 'files' || mode === 'actions';

// Chat rows come from two sources — loaded chat lists (instant title fuzzy match) and
// the backend message-content search (Chats tab only) — normalized to one display shape.
interface ChatRowItem {
  id: string;
  title: string;
  workspaceName?: string;
  matchCount?: number;
}

// One flat list drives both keyboard navigation and rendering of the sectioned
// main-mode results, so their ordering can never diverge.
type MenuListItem =
  | { kind: 'chat'; chat: ChatRowItem }
  | { kind: 'file'; file: FlatFileItem }
  | { kind: 'command'; command: CommandItem };

interface MenuRowProps {
  id: string;
  index: number;
  isActive: boolean;
  itemRef: Ref<HTMLDivElement> | undefined;
  onActivate: (index: number, e: ReactMouseEvent) => void;
  onSelect: () => void;
  disabled?: boolean;
  // Controls rendered outside the option button (shortcut hint, split buttons).
  trailing?: ReactNode;
  children: ReactNode;
}

// Shared row shell — active highlight, synthetic-hover guard, option semantics.
// Only the button content (and optional trailing controls) differ per row type.
function MenuRow({
  id,
  index,
  isActive,
  itemRef,
  onActivate,
  onSelect,
  disabled,
  trailing,
  children,
}: MenuRowProps) {
  return (
    <div
      ref={itemRef}
      className={cn(
        rowClass,
        isActive
          ? 'bg-surface-active dark:bg-surface-dark-active'
          : 'hover:bg-surface-hover dark:hover:bg-surface-dark-hover',
      )}
      onMouseMove={(e) => onActivate(index, e)}
    >
      <Button
        variant="unstyled"
        id={id}
        role="option"
        aria-selected={isActive}
        className="flex flex-1 items-center gap-3 overflow-hidden"
        onMouseDown={(e) => e.preventDefault()}
        onClick={onSelect}
        disabled={disabled}
      >
        {children}
      </Button>
      {trailing}
    </div>
  );
}

export function CommandMenu() {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [mode, setMode] = useState<MenuMode>('all');
  const inputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const chatSearchInputRef = useRef<HTMLInputElement>(null);
  const previousFocusRef = useRef<Element | null>(null);
  const activeItemRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef({ activeIndex: 0, mode: 'all' as MenuMode });
  const listItemsRef = useRef<MenuListItem[]>([]);
  const filteredBranchesRef = useRef<string[]>([]);
  const filteredThemesRef = useRef<ThemeMeta[]>([]);
  const listLengthRef = useRef(0);
  // Browsers replay hover events when rows render or scroll under a stationary cursor
  // (dialog open, mode switch, arrow-key scrollIntoView) — only honor real pointer movement.
  const lastMouseRef = useRef<{ x: number; y: number } | null>(null);
  const listId = 'command-menu-list';

  const isOpen = useUIStore((state) => state.commandMenuOpen);
  const theme = useUIStore((state) => state.theme);
  const isMobile = useIsMobile();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  // On-screen tile ids (not deduped view kinds) so the active-state/split
  // affordances can distinguish a view's primary tile from its `:secondary`
  // variant. Keyed on visibility, not open membership — views have no tabs, so an
  // open-but-hidden background tile must stay surfaceable/splittable. Gated on
  // open — layout churn is irrelevant while the always-mounted menu is closed.
  const visibleLayout = useUIStore((s) => (s.commandMenuOpen ? s.visibleLayout : null));
  const leafTileIds = useMemo(() => new Set(visibleLayout?.flat() ?? []), [visibleLayout]);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const primaryCtx = useChatContext();

  // File/search/branch actions target the pane the user last interacted with — in
  // split view the secondary pane is a different chat with its own files/cwd/tiles.
  const activeAgentTile = useUIStore((s) =>
    s.commandMenuOpen ? s.activeAgentTile : 'agent:primary',
  );
  const secondaryChatId = useUIStore((s) => s.secondaryChatId);
  const useSecondary = isSecondaryPaneActive(activeAgentTile, secondaryChatId);
  // Resolve the active pane's chat through the canonical hook, gated on the menu
  // being open so the always-mounted menu doesn't re-render on pane/secondary
  // churn while closed. Only used for the secondary pane — the primary reuses the
  // chat context directly below (its files/chatId are available there immediately).
  const activeChat = useActiveChat(isOpen);
  const secondaryChat = useSecondary ? activeChat : undefined;
  const { fileStructure: secondaryFiles } = useSandboxFiles(
    secondaryChat ?? undefined,
    useSecondary ? (secondaryChatId ?? undefined) : undefined,
  );

  const chatId = useSecondary ? (secondaryChatId ?? undefined) : primaryCtx.chatId;
  const fileStructure = useSecondary ? secondaryFiles : primaryCtx.fileStructure;
  const sandboxId = useSecondary ? (secondaryChat?.sandbox_id ?? undefined) : primaryCtx.sandboxId;
  const worktreeCwd = useSecondary
    ? (secondaryChat?.worktree_cwd ?? undefined)
    : primaryCtx.worktreeCwd;

  // Fetch branches whenever the menu is open so we can both render the branches mode and
  // filter the switch-branch command out of the list for chats without a repo. Cache is
  // usually warm from BranchSelector so this rarely triggers a real fetch.
  const { data: branchesData } = useGitBranchesQuery(sandboxId, isOpen && !!sandboxId, worktreeCwd);
  const checkoutBranch = useCheckoutBranchMutation();

  const canSwitchBranch = !!branchesData?.is_git_repo && branchesData.branches.length > 0;

  // Chat rows reuse the sidebar's queries (cache-warm on every page the menu mounts on),
  // gated on open + auth so the always-mounted menu doesn't fetch while closed or logged out.
  const chatQueriesEnabled = isOpen && isAuthenticated;
  const workspaces = useWorkspacesList({ enabled: chatQueriesEnabled });
  const { pinnedChats, recentChats, workspaceBadgeById } = useSidebarChatLists(
    workspaces,
    chatQueriesEnabled,
  );
  const menuChats = useMemo(() => {
    if (!isOpen) return [];
    // Pinned and recents are disjoint; the menu is a single recency-ordered list.
    return [...pinnedChats, ...recentChats].sort(
      (a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at),
    );
  }, [isOpen, pinnedChats, recentChats]);

  const flatFiles = useMemo(() => flattenFiles(fileStructure), [fileStructure]);

  const filteredChats = useMemo(
    () =>
      mode !== 'all' && mode !== 'chats'
        ? []
        : fuzzySearch(query, menuChats, { keys: ['title'], limit: mode === 'chats' ? 30 : 5 }),
    [query, menuChats, mode],
  );

  // Deep search runs on the Chats tab only — the All tab stays instant/local; the
  // "Search in chats" action remains the snippet-level browser for message matches.
  const debouncedQuery = useDebouncedValue(query, 250);
  const deepSearchQuery = mode === 'chats' ? debouncedQuery.trim() : '';
  const {
    data: chatSearchData,
    isFetching: isSearchingChats,
    isPlaceholderData: isStaleChatSearch,
  } = useSearchChatsQuery(deepSearchQuery, { enabled: isOpen && deepSearchQuery.length >= 2 });
  const trimmedQuery = query.trim();
  // Debounce/fetch lag — content rows are hidden while the search trails the input,
  // so show the searching hint instead of a misleading empty or settled list.
  const isChatSearchPending =
    mode === 'chats' &&
    trimmedQuery.length >= 2 &&
    (deepSearchQuery !== trimmedQuery || isSearchingChats);

  const chatRows = useMemo<ChatRowItem[]>(() => {
    const titleRows = filteredChats.map((chat) => ({
      id: chat.id,
      title: chat.title,
      workspaceName: workspaceBadgeById.get(chat.workspace_id)?.name,
    }));
    // Stale rows are selectable, so a quick Enter could open a chat unrelated to the
    // current input. Two windows produce them: the debounce lag (deepSearchQuery still
    // holds the previous term) and keepPreviousData while a new request is in flight
    // (placeholder response for the previous term). Hide content rows through both;
    // the length gate keeps the section query-driven below the search minimum.
    if (
      mode !== 'chats' ||
      deepSearchQuery.length < 2 ||
      deepSearchQuery !== trimmedQuery ||
      !chatSearchData ||
      isStaleChatSearch
    ) {
      return titleRows;
    }
    // Content-only hits go below title matches, deduped by chat id.
    const titleIds = new Set(titleRows.map((row) => row.id));
    const contentRows = chatSearchData.results
      .filter((result) => !titleIds.has(result.chat_id))
      .map((result) => ({
        id: result.chat_id,
        title: result.chat_title,
        workspaceName: result.workspace_name,
        matchCount: result.match_count,
      }));
    return [...titleRows, ...contentRows];
  }, [
    filteredChats,
    workspaceBadgeById,
    mode,
    deepSearchQuery,
    trimmedQuery,
    chatSearchData,
    isStaleChatSearch,
  ]);

  const filteredFiles = useMemo(
    () =>
      mode !== 'all' && mode !== 'files'
        ? []
        : fuzzySearch(query, flatFiles, {
            keys: ['name', 'path'],
            limit: mode === 'files' ? 30 : 5,
          }),
    [query, flatFiles, mode],
  );

  const visibleCommands = useMemo(
    () =>
      ALL_COMMANDS.filter((cmd) => {
        if (isMobile && cmd.hideOnMobile) return false;
        if (cmd.requiresChat && !chatId) return false;
        if (cmd.requiresSandbox && !sandboxId) return false;
        if (cmd.id === 'switch-branch' && !canSwitchBranch) return false;
        return true;
      }),
    [isMobile, canSwitchBranch, chatId, sandboxId],
  );

  const filteredCommands = useMemo(
    () =>
      mode !== 'all' && mode !== 'actions'
        ? []
        : fuzzySearch(query, visibleCommands, { keys: ['label'], limit: 20 }),
    [query, visibleCommands, mode],
  );

  const listItems = useMemo<MenuListItem[]>(
    () => [
      ...chatRows.map((chat) => ({ kind: 'chat' as const, chat })),
      ...filteredFiles.map((file) => ({ kind: 'file' as const, file })),
      ...filteredCommands.map((command) => ({ kind: 'command' as const, command })),
    ],
    [chatRows, filteredFiles, filteredCommands],
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

  const filteredThemes = useMemo(
    () => (mode !== 'themes' ? [] : fuzzySearch(query, THEMES, { keys: ['label'], limit: 30 })),
    [mode, query],
  );

  const listLength =
    mode === 'branches'
      ? filteredBranches.length
      : mode === 'themes'
        ? filteredThemes.length
        : listItems.length;

  const activateFromMouse = (index: number, e: ReactMouseEvent) => {
    const last = lastMouseRef.current;
    lastMouseRef.current = { x: e.clientX, y: e.clientY };
    // First event after open/mode-switch or a same-coords replay is synthetic — skip it.
    if (!last || (last.x === e.clientX && last.y === e.clientY)) return;
    setActiveIndex(index);
  };

  const switchMode = useCallback((next: MenuMode) => {
    // Re-arm the synthetic-event guard — the new mode's list renders under the cursor.
    lastMouseRef.current = null;
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

  // Tab clicks and ⌘[/⌘] keep the typed query — filters narrow the current search.
  const switchFilter = useCallback((next: MainFilter) => {
    lastMouseRef.current = null;
    setMode(next);
    setActiveIndex(0);
  }, []);

  useEffect(() => {
    if (isOpen) {
      previousFocusRef.current = document.activeElement;
      // switchMode also focuses the right input for the target mode.
      const ui = useUIStore.getState();
      switchMode(ui.pendingMenuMode ?? 'all');
      ui.setPendingMenuMode(null);
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
      executeCommand(cmd, queryClient, navigate, false, { sandboxId, worktreeCwd });
      close();
    },
    [close, queryClient, navigate, sandboxId, worktreeCwd],
  );

  // Commands either dispatch an action or switch the menu into a sub-mode/filter.
  const runCommand = useCallback(
    (cmd: CommandItem) => {
      const nextMode = COMMAND_TO_MODE[cmd.id];
      if (nextMode) switchMode(nextMode);
      else handleSelectItem(cmd);
    },
    [switchMode, handleSelectItem],
  );

  const handleSelectFile = useCallback(
    (file: FlatFileItem) => {
      // Jumps target the active chat's editor, or the chat-less landing editor
      // (undefined chatId) when browsing workspace files before a chat exists.
      useUIStore.getState().openFileInEditor(file.path, chatId);
      close();
    },
    [close, chatId],
  );

  const handleOpenSearchResult = useCallback(
    (path: string, lineNumber: number) => {
      useUIStore.getState().openFileInEditor(path, chatId, lineNumber);
      close();
    },
    [close, chatId],
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

  const handleSelectTheme = useCallback(
    (value: Theme) => {
      useUIStore.getState().setTheme(value);
      close();
    },
    [close],
  );

  const handleSplit = useCallback(
    (viewId: ViewType, direction: SplitDirection) => {
      useUIStore.getState().addViewToSplit(viewId, direction);
      close();
    },
    [close],
  );

  stateRef.current.activeIndex = activeIndex;
  stateRef.current.mode = mode;
  listItemsRef.current = listItems;
  filteredBranchesRef.current = filteredBranches;
  filteredThemesRef.current = filteredThemes;
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
        // hijack Enter/arrows here. Only wire Escape to step back to the main list.
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopImmediatePropagation();
          switchMode('all');
        }
        return;
      }

      // ⌘[/⌘] cycle the main-mode filter tabs (preventDefault also blocks the
      // browser's back/forward navigation bound to these chords).
      if (isMainMode(m) && (e.metaKey || e.ctrlKey) && (e.key === '[' || e.key === ']')) {
        e.preventDefault();
        e.stopImmediatePropagation();
        const step = e.key === ']' ? 1 : -1;
        const current = MAIN_FILTERS.indexOf(m);
        switchFilter(MAIN_FILTERS[(current + step + MAIN_FILTERS.length) % MAIN_FILTERS.length]);
        return;
      }

      switch (e.key) {
        case 'Escape':
          e.preventDefault();
          e.stopImmediatePropagation();
          if (m === 'branches' || m === 'themes') {
            switchMode('all');
          } else if (m !== 'all') {
            switchFilter('all');
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
          if (m === 'branches') {
            const branch = filteredBranchesRef.current[idx];
            if (branch) handleSelectBranch(branch);
          } else if (m === 'themes') {
            const themeItem = filteredThemesRef.current[idx];
            if (themeItem) handleSelectTheme(themeItem.value);
          } else {
            const item = listItemsRef.current[idx];
            if (!item) break;
            if (item.kind === 'chat') {
              handleOpenChatResult(item.chat.id);
            } else if (item.kind === 'file') {
              handleSelectFile(item.file);
            } else {
              runCommand(item.command);
            }
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true });
  }, [
    isOpen,
    runCommand,
    handleSelectFile,
    handleOpenChatResult,
    handleSelectBranch,
    handleSelectTheme,
    switchMode,
    switchFilter,
    close,
  ]);

  if (!isOpen) return null;

  const modKey = IS_MAC_PLATFORM ? '⌘' : 'Ctrl+';

  const renderMainRow = (item: MenuListItem, index: number) => {
    const rowProps = {
      index,
      isActive: index === activeIndex,
      itemRef: index === activeIndex ? activeItemRef : undefined,
      onActivate: activateFromMouse,
      id: `menu-item-${index}`,
    };
    // Sections are contiguous by kind, so a header renders on each kind transition.
    const prevKind = listItems[index - 1]?.kind;
    const showHeader = mode === 'all' && prevKind !== item.kind;

    if (item.kind === 'chat') {
      const { chat } = item;
      return (
        <Fragment key={`chat-${chat.id}`}>
          {showHeader && (
            <p className={sectionHeaderClass}>{trimmedQuery ? 'Chats' : 'Recent chats'}</p>
          )}
          <MenuRow {...rowProps} onSelect={() => handleOpenChatResult(chat.id)}>
            <MessageSquare className="h-3.5 w-3.5 shrink-0 text-text-tertiary dark:text-text-dark-tertiary" />
            <HighlightMatch
              text={chat.title}
              searchQuery={query}
              className="flex-1 truncate text-left font-medium"
            />
            {/* Content hits show the match count — it explains why a title
                that doesn't match the query is listed. */}
            {(chat.matchCount != null || chat.workspaceName) && (
              <span className="shrink-0 text-text-quaternary dark:text-text-dark-quaternary">
                {chat.matchCount != null
                  ? `${chat.matchCount} ${chat.matchCount === 1 ? 'match' : 'matches'}`
                  : chat.workspaceName}
              </span>
            )}
          </MenuRow>
        </Fragment>
      );
    }

    if (item.kind === 'file') {
      const { file } = item;
      return (
        <Fragment key={`file-${file.path}`}>
          {showHeader && <p className={sectionHeaderClass}>Files</p>}
          <MenuRow {...rowProps} onSelect={() => handleSelectFile(file)}>
            <File className="h-3.5 w-3.5 shrink-0 text-text-tertiary dark:text-text-dark-tertiary" />
            <span className="truncate">
              <HighlightMatch text={file.name} searchQuery={query} className="font-medium" />
              <span className="ml-2 text-text-quaternary dark:text-text-dark-quaternary">
                {file.path}
              </span>
            </span>
          </MenuRow>
        </Fragment>
      );
    }

    const cmd = item.command;
    const Icon = cmd.icon;
    // Active/split state is scoped to the pane the user is in: the view counts as
    // active only if the active pane's target tile (e.g. editor:secondary) is
    // already on screen, so the split buttons stay available to surface it beside
    // the other panes.
    const isViewActive =
      cmd.type === 'view' && leafTileIds.has(viewTypeToTileId(cmd.id, useSecondary));
    return (
      <Fragment key={`command-${cmd.id}`}>
        {showHeader && <p className={sectionHeaderClass}>Actions</p>}
        <MenuRow
          {...rowProps}
          onSelect={() => runCommand(cmd)}
          trailing={
            <>
              {!isMobile && cmd.shortcut && (
                <kbd className="ml-auto shrink-0 font-mono text-2xs text-text-quaternary dark:text-text-dark-quaternary">
                  {formatShortcut(cmd.shortcut)}
                </kbd>
              )}
              {cmd.type === 'view' && !isMobile && !isViewActive && (
                <div className="flex items-center gap-0.5">
                  <FloatingTooltip content="Split right" className="flex">
                    <Button
                      variant="unstyled"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => handleSplit(cmd.id, 'row')}
                      className={splitButtonClass}
                      aria-label="Split right"
                    >
                      <PanelRight className="h-3 w-3" />
                    </Button>
                  </FloatingTooltip>
                  <FloatingTooltip content="Split down" className="flex">
                    <Button
                      variant="unstyled"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => handleSplit(cmd.id, 'column')}
                      className={splitButtonClass}
                      aria-label="Split down"
                    >
                      <PanelBottom className="h-3 w-3" />
                    </Button>
                  </FloatingTooltip>
                </div>
              )}
            </>
          }
        >
          <Icon className="h-3.5 w-3.5 shrink-0 text-text-tertiary dark:text-text-dark-tertiary" />
          <HighlightMatch text={cmd.label} searchQuery={query} className="flex-1 text-left" />
          {isViewActive && (
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-text-primary dark:bg-text-dark-primary" />
          )}
        </MenuRow>
      </Fragment>
    );
  };

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
          'mt-20 h-fit w-full max-w-2xl',
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
                onClick={() => switchMode('all')}
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
                onClick={() => switchMode('all')}
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
              {(mode === 'branches' || mode === 'themes') && (
                <Button
                  variant="unstyled"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => switchMode('all')}
                  className="shrink-0 rounded-md bg-surface-hover px-1.5 py-0.5 text-2xs font-medium text-text-secondary dark:bg-surface-dark-hover dark:text-text-dark-secondary"
                >
                  {mode === 'branches' ? 'Branches' : 'Themes'}
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
                  mode === 'branches'
                    ? 'Search branches...'
                    : mode === 'themes'
                      ? 'Search themes...'
                      : mode === 'chats'
                        ? 'Search chats and messages...'
                        : mode === 'files'
                          ? 'Search files...'
                          : mode === 'actions'
                            ? 'Search actions...'
                            : 'Search chats, files, actions...'
                }
                className="h-10 w-full bg-transparent text-sm text-text-primary outline-none placeholder:text-text-quaternary dark:text-text-dark-primary dark:placeholder:text-text-dark-quaternary"
                role="combobox"
                aria-expanded="true"
                aria-controls={listId}
                aria-activedescendant={
                  mode === 'branches'
                    ? filteredBranches[activeIndex]
                      ? `branch-item-${activeIndex}`
                      : undefined
                    : mode === 'themes'
                      ? filteredThemes[activeIndex]
                        ? `theme-item-${activeIndex}`
                        : undefined
                      : listItems[activeIndex]
                        ? `menu-item-${activeIndex}`
                        : undefined
                }
              />
            </div>

            {isMainMode(mode) && (
              <div className="flex items-center gap-1 border-b border-border/50 px-3 py-2 dark:border-border-dark/50">
                {MAIN_FILTERS.map((filter) => (
                  <Button
                    key={filter}
                    variant="unstyled"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => switchFilter(filter)}
                    className={cn(
                      'rounded-md px-2.5 py-1 text-xs font-medium transition-colors duration-200',
                      filter === mode
                        ? 'bg-surface-active text-text-primary dark:bg-surface-dark-active dark:text-text-dark-primary'
                        : 'text-text-tertiary hover:bg-surface-hover hover:text-text-primary dark:text-text-dark-tertiary dark:hover:bg-surface-dark-hover dark:hover:text-text-dark-primary',
                    )}
                  >
                    {FILTER_LABELS[filter]}
                  </Button>
                ))}
              </div>
            )}

            <div className="max-h-[24rem] overflow-y-auto py-1" role="listbox" id={listId}>
              {mode === 'branches' ? (
                <>
                  {filteredBranches.map((branch, index) => (
                    <MenuRow
                      key={branch}
                      id={`branch-item-${index}`}
                      index={index}
                      isActive={index === activeIndex}
                      itemRef={index === activeIndex ? activeItemRef : undefined}
                      onActivate={activateFromMouse}
                      onSelect={() => handleSelectBranch(branch)}
                      disabled={checkoutBranch.isPending}
                    >
                      <GitBranch className="h-3.5 w-3.5 shrink-0 text-text-tertiary dark:text-text-dark-tertiary" />
                      <HighlightMatch
                        text={branch}
                        searchQuery={query}
                        className="flex-1 truncate text-left font-mono"
                      />
                      {branch === branchesData?.current_branch && (
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-text-primary dark:bg-text-dark-primary" />
                      )}
                    </MenuRow>
                  ))}
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
              ) : mode === 'themes' ? (
                <>
                  {filteredThemes.map((themeItem, index) => {
                    const Icon = themeItem.icon;
                    return (
                      <MenuRow
                        key={themeItem.value}
                        id={`theme-item-${index}`}
                        index={index}
                        isActive={index === activeIndex}
                        itemRef={index === activeIndex ? activeItemRef : undefined}
                        onActivate={activateFromMouse}
                        onSelect={() => handleSelectTheme(themeItem.value)}
                      >
                        <Icon className="h-3.5 w-3.5 shrink-0 text-text-tertiary dark:text-text-dark-tertiary" />
                        <HighlightMatch
                          text={themeItem.label}
                          searchQuery={query}
                          className="flex-1 truncate text-left"
                        />
                        {themeItem.value === theme && (
                          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-text-primary dark:bg-text-dark-primary" />
                        )}
                      </MenuRow>
                    );
                  })}
                  {filteredThemes.length === 0 && (
                    <p className="px-3 py-4 text-center text-xs text-text-quaternary dark:text-text-dark-quaternary">
                      No matching themes
                    </p>
                  )}
                </>
              ) : (
                <>
                  {listItems.map(renderMainRow)}
                  {isChatSearchPending && (
                    <p className="px-3 py-2 text-center text-2xs text-text-quaternary dark:text-text-dark-quaternary">
                      Searching messages…
                    </p>
                  )}
                  {listItems.length === 0 && !isChatSearchPending && (
                    <p className="px-3 py-4 text-center text-xs text-text-quaternary dark:text-text-dark-quaternary">
                      {mode === 'chats'
                        ? 'No matching chats'
                        : mode === 'files'
                          ? 'No matching files'
                          : mode === 'actions'
                            ? 'No matching actions'
                            : 'No results'}
                    </p>
                  )}
                </>
              )}
            </div>

            {!isMobile && (
              <div className="flex items-center justify-between border-t border-border/50 px-3 py-2 dark:border-border-dark/50">
                <span className="text-2xs text-text-quaternary dark:text-text-dark-quaternary">
                  {mode === 'branches'
                    ? '↵ Switch branch · Esc to go back'
                    : mode === 'themes'
                      ? '↵ Set theme · Esc to go back'
                      : `↑↓ Select · ↵ Open · ${modKey}[ or ${modKey}] change filter · Esc to close`}
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
