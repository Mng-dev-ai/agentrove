import { useMemo } from 'react';
import { useUIStore } from '@/store/uiStore';
import { useAuthStore } from '@/store/authStore';
import { useIsMobile } from '@/hooks/useIsMobile';
import { isSecondaryPaneActive } from '@/utils/tileHelpers';
import { useChatContext } from '@/hooks/useChatContext';
import { useActiveChat } from '@/hooks/useActiveChat';
import { useSandboxFiles } from '@/hooks/useSandboxFiles';
import { useGitBranchesQuery, useCheckoutBranchMutation } from '@/hooks/queries/useSandboxQueries';
import { useWorkspacesList } from '@/hooks/queries/useWorkspaceQueries';
import { useSidebarChatLists } from '@/hooks/queries/useSidebarChatLists';
import { useSearchChatsQuery } from '@/hooks/queries/useChatQueries';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { fuzzySearch } from '@/utils/fuzzySearch';
import { THEMES } from '@/utils/theme';
import {
  ALL_COMMANDS,
  flattenFiles,
  type ChatRowItem,
  type MenuListItem,
  type MenuMode,
} from './commandRegistry';

export function useCommandMenuData(mode: MenuMode, query: string) {
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

  return {
    isOpen,
    isMobile,
    theme,
    leafTileIds,
    useSecondary,
    chatId,
    sandboxId,
    worktreeCwd,
    branchesData,
    checkoutBranch,
    listItems,
    listLength,
    filteredBranches,
    filteredThemes,
    trimmedQuery,
    isChatSearchPending,
  };
}
