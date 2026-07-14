import { useState, useEffect, useRef, useCallback } from 'react';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useUIStore } from '@/store/uiStore';
import { type ThemeMeta } from '@/utils/theme';
import { IS_MAC_PLATFORM } from '@/utils/platform';
import type { ViewType, SplitDirection, Theme } from '@/types/ui.types';
import { useCommandMenuData } from './useCommandMenuData';
import { isMainMode, isPanelMode } from './commandMenuModes';
import {
  COMMAND_TO_MODE,
  FILTER_SHORTCUT_MAP,
  MAIN_FILTERS,
  executeCommand,
  type CommandItem,
  type FlatFileItem,
  type MainFilter,
  type MenuListItem,
  type MenuMode,
} from './commandRegistry';

export function useCommandMenu() {
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

  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const {
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
  } = useCommandMenuData(mode, query);

  const activateFromMouse = (index: number, e: React.MouseEvent) => {
    const last = lastMouseRef.current;
    lastMouseRef.current = { x: e.clientX, y: e.clientY };
    // First event after open/mode-switch or a same-coords replay is synthetic — skip it.
    if (!last || (last.x === e.clientX && last.y === e.clientY)) return;
    setActiveIndex(index);
  };

  // The panels own their inputs; focus the right one after React flushes the mode change.
  const focusModeInput = useCallback((next: MenuMode) => {
    requestAnimationFrame(() => {
      if (next === 'grep') searchInputRef.current?.focus();
      else if (next === 'messages') chatSearchInputRef.current?.focus();
      else inputRef.current?.focus();
    });
  }, []);

  const switchMode = useCallback(
    (next: MenuMode) => {
      // Re-arm the synthetic-event guard — the new mode's list renders under the cursor.
      lastMouseRef.current = null;
      setMode(next);
      setQuery('');
      setActiveIndex(0);
      focusModeInput(next);
    },
    [focusModeInput],
  );

  // Tab clicks and ⌘[/⌘] keep the typed query — filters narrow the current search.
  // Crossing to/from a panel tab remounts the focused input, so refocus explicitly.
  const switchFilter = useCallback(
    (next: MainFilter) => {
      lastMouseRef.current = null;
      setMode(next);
      setActiveIndex(0);
      focusModeInput(next);
    },
    [focusModeInput],
  );

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

      // ⌘⇧<key> jumps straight to a filter tab, mirroring the global open-on-tab chords.
      if (isMainMode(m) && (e.metaKey || e.ctrlKey) && e.shiftKey) {
        const filter = FILTER_SHORTCUT_MAP.get(e.code);
        if (filter) {
          e.preventDefault();
          e.stopImmediatePropagation();
          switchFilter(filter);
          return;
        }
      }

      if (isPanelMode(m)) {
        // The embedded panel handles its own typing + click-to-open; don't
        // hijack Enter/arrows here. Only wire Escape to close the menu.
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopImmediatePropagation();
          close();
        }
        return;
      }

      switch (e.key) {
        case 'Escape':
          e.preventDefault();
          e.stopImmediatePropagation();
          close();
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
    switchFilter,
    close,
  ]);

  const modKey = IS_MAC_PLATFORM ? '⌘' : 'Ctrl+';

  const activeDescendant =
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
          : undefined;

  return {
    isOpen,
    close,
    mode,
    switchMode,
    switchFilter,
    query,
    setQuery,
    setActiveIndex,
    activeIndex,
    inputRef,
    searchInputRef,
    chatSearchInputRef,
    activeItemRef,
    listId,
    activeDescendant,
    activateFromMouse,
    trimmedQuery,
    isMobile,
    listItems,
    leafTileIds,
    useSecondary,
    handleOpenChatResult,
    handleSelectFile,
    runCommand,
    handleSplit,
    filteredBranches,
    branchesData,
    sandboxId,
    worktreeCwd,
    checkoutBranch,
    handleSelectBranch,
    filteredThemes,
    theme,
    handleSelectTheme,
    handleOpenSearchResult,
    modKey,
  };
}
