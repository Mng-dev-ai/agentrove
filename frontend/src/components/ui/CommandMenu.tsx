import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Button } from '@/components/ui/primitives/Button';
import { Input } from '@/components/ui/primitives/Input';
import { createPortal } from 'react-dom';
import { GitBranch, Search, PanelRight, PanelBottom, File } from 'lucide-react';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';
import { useUIStore } from '@/store/uiStore';
import { useQueryClient } from '@tanstack/react-query';
import { useIsMobile } from '@/hooks/useIsMobile';
import { isSecondaryPaneActive, viewTypeToTileId } from '@/utils/tileHelpers';
import { useChatContext } from '@/hooks/useChatContext';
import { useActiveChat } from '@/hooks/useActiveChat';
import { useSandboxFiles } from '@/hooks/useSandboxFiles';
import { useGitBranchesQuery, useCheckoutBranchMutation } from '@/hooks/queries/useSandboxQueries';
import { fuzzySearch } from '@/utils/fuzzySearch';
import { HighlightMatch } from '@/components/ui/shared/HighlightMatch';
import { SearchPanel } from '@/components/editor/file-search/SearchPanel';
import { ChatSearchPanel } from '@/components/chat/chat-search/ChatSearchPanel';
import { cn } from '@/utils/cn';
import { THEMES, type ThemeMeta } from '@/utils/theme';
import type { ViewType, SplitDirection, Theme } from '@/types/ui.types';
import {
  ALL_COMMANDS,
  COMMAND_TO_MODE,
  executeCommand,
  flattenFiles,
  formatShortcut,
  type CommandItem,
  type FlatFileItem,
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
  const filteredThemesRef = useRef<ThemeMeta[]>([]);
  const listLengthRef = useRef(0);
  const listId = 'command-menu-list';

  const isOpen = useUIStore((state) => state.commandMenuOpen);
  const theme = useUIStore((state) => state.theme);
  const isMobile = useIsMobile();
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
        if (cmd.requiresSandbox && !sandboxId) return false;
        if (cmd.id === 'switch-branch' && !canSwitchBranch) return false;
        return true;
      }),
    [isMobile, canSwitchBranch, chatId, sandboxId],
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

  const filteredThemes = useMemo(
    () => (mode !== 'themes' ? [] : fuzzySearch(query, THEMES, { keys: ['label'], limit: 30 })),
    [mode, query],
  );

  const listLength =
    mode === 'files'
      ? filteredFiles.length
      : mode === 'branches'
        ? filteredBranches.length
        : mode === 'themes'
          ? filteredThemes.length
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
      const ui = useUIStore.getState();
      switchMode(ui.pendingMenuMode ?? 'commands');
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
  filteredFilesRef.current = filteredFiles;
  filteredCommandsRef.current = filteredCommands;
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
          if (m === 'files' || m === 'branches' || m === 'themes') {
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
          } else if (m === 'themes') {
            const themeItem = filteredThemesRef.current[idx];
            if (themeItem) handleSelectTheme(themeItem.value);
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
  }, [
    isOpen,
    handleSelectItem,
    handleSelectFile,
    handleSelectBranch,
    handleSelectTheme,
    switchMode,
    close,
  ]);

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
              {(mode === 'files' || mode === 'branches' || mode === 'themes') && (
                <Button
                  variant="unstyled"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => switchMode('commands')}
                  className="shrink-0 rounded-md bg-surface-hover px-1.5 py-0.5 text-2xs font-medium text-text-secondary dark:bg-surface-dark-hover dark:text-text-dark-secondary"
                >
                  {mode === 'files' ? 'Files' : mode === 'branches' ? 'Branches' : 'Themes'}
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
                      : mode === 'themes'
                        ? 'Search themes...'
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
                      : mode === 'themes'
                        ? filteredThemes[activeIndex]
                          ? `theme-item-${activeIndex}`
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
              ) : mode === 'themes' ? (
                <>
                  {filteredThemes.map((themeItem, index) => {
                    const Icon = themeItem.icon;
                    const isActive = themeItem.value === theme;
                    return (
                      <div
                        key={themeItem.value}
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
                          id={`theme-item-${index}`}
                          role="option"
                          aria-selected={index === activeIndex}
                          className="flex flex-1 items-center gap-3 overflow-hidden"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => handleSelectTheme(themeItem.value)}
                        >
                          <Icon className="h-3.5 w-3.5 shrink-0 text-text-tertiary dark:text-text-dark-tertiary" />
                          <HighlightMatch
                            text={themeItem.label}
                            searchQuery={query}
                            className="flex-1 truncate text-left"
                          />
                          {isActive && (
                            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-text-primary dark:bg-text-dark-primary" />
                          )}
                        </Button>
                      </div>
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
                  {filteredCommands.map((cmd, index) => {
                    const Icon = cmd.icon;
                    // Active/split state is scoped to the pane the user is in: the
                    // view counts as active only if the active pane's target tile
                    // (e.g. editor:secondary) is already on screen, so the split
                    // buttons stay available to surface it beside the other panes.
                    const isActive =
                      cmd.type === 'view' &&
                      leafTileIds.has(viewTypeToTileId(cmd.id, useSecondary));

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
                      : mode === 'themes'
                        ? '↵ Set theme · Esc to go back'
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
