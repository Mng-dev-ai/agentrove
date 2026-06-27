import { useCallback, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useParams } from 'react-router-dom';
import { MoreHorizontal, PanelBottom, PanelRight, X } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button';
import { useUIStore } from '@/store/uiStore';
import { useChatStore } from '@/store/chatStore';
import { useChatQuery } from '@/hooks/queries/useChatQueries';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useDropdown } from '@/hooks/useDropdown';
import { cn } from '@/utils/cn';
import { isSecondaryTile, tileIdToViewType, VIEW_LABELS } from '@/utils/tileHelpers';
import type { SplitDirection, TileId } from '@/types/ui.types';

const TAB_BUTTON_CLASS = cn(
  'flex items-center justify-center',
  'h-5 w-4 rounded-md',
  'text-text-tertiary dark:text-text-dark-tertiary',
  'hover:text-text-primary dark:hover:text-text-dark-primary',
  'transition-colors duration-200',
);

const MENU_ITEM_CLASS = cn(
  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-2xs font-medium',
  'text-text-secondary hover:bg-surface-hover hover:text-text-primary',
  'dark:text-text-dark-secondary dark:hover:bg-surface-dark-hover dark:hover:text-text-dark-primary',
  'transition-colors duration-200',
);

interface TabParts {
  // The chat name (or view label) — truncates when space is tight.
  name: string;
  // The view kind ('Terminal'/'Editor'…) — pinned so it stays visible when the
  // name truncates. Only set for non-agent tiles in split-chat, where each view
  // has two copies that the chat-name prefix disambiguates.
  kind?: string;
}

function tabParts(
  tileId: TileId,
  primaryTitle: string | undefined,
  secondaryTitle: string | undefined,
): TabParts {
  const view = tileIdToViewType(tileId);
  const chatTitle = isSecondaryTile(tileId) ? secondaryTitle : primaryTitle;
  if (view === 'agent') return { name: chatTitle ?? VIEW_LABELS.agent };
  const kind = VIEW_LABELS[view];
  // Outside split-chat (no secondary title) a non-agent tab is just its kind.
  return secondaryTitle && chatTitle ? { name: chatTitle, kind } : { name: kind };
}

// Pane tabs in the title bar — one per open tab. Clicking a tab shows it full;
// the right-click / "⋯" menu splits it beside the on-screen panes or closes it.
// Visible (on-screen) tabs are highlighted; the rest are mounted in the background.
export function SplitTabs() {
  const { chatId } = useParams();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const openTabs = useUIStore((s) => s.openTabs);
  const visibleLayout = useUIStore((s) => s.visibleLayout);
  const secondaryChatId = useUIStore((s) => s.secondaryChatId);
  const currentChat = useChatStore((s) => s.currentChat);
  // Shares the chat-query cache with AgentPane / the page; used only for the
  // secondary pane's tab label.
  const secondaryTitle = useChatQuery(secondaryChatId ?? undefined).data?.title;

  // The tab menu is portaled to the body so the strip's overflow-x-auto can't clip
  // it; positioned with fixed coords captured from the trigger on open.
  const { isOpen: menuOpen, dropdownRef: menuRef, setIsOpen: setMenuOpen } = useDropdown();
  const [menu, setMenu] = useState<{ tileId: TileId; top: number; right: number } | null>(null);

  const visibleSet = useMemo(() => new Set(visibleLayout.flat()), [visibleLayout]);

  // Only the routed chat owns a title; on the landing split currentChat may be
  // stale, so fall back to the generic view label there.
  const primaryTitle = chatId ? currentChat?.title : undefined;

  const handleCloseTile = useCallback(
    (tileId: TileId) => {
      const ui = useUIStore.getState();
      if (tileId === 'agent:secondary') {
        ui.closeSplitChat();
        return;
      }
      if (tileId === 'agent:primary' && ui.secondaryChatId && chatId) {
        const newPrimary = ui.swapChatPanes(chatId);
        if (newPrimary) {
          navigate(`/chat/${newPrimary}`);
          ui.closeSplitChat();
          return;
        }
      }
      ui.removeTab(tileId);
    },
    [chatId, navigate],
  );

  const openMenu = useCallback(
    (tileId: TileId, anchor: HTMLElement) => {
      const rect = anchor.getBoundingClientRect();
      setMenu({ tileId, top: rect.bottom + 4, right: window.innerWidth - rect.right });
      setMenuOpen(true);
    },
    [setMenuOpen],
  );

  const handleSplit = useCallback(
    (direction: SplitDirection, tileId: TileId) => {
      useUIStore.getState().splitView(direction, tileId);
      setMenuOpen(false);
    },
    [setMenuOpen],
  );

  const handleCloseFromMenu = useCallback(
    (tileId: TileId) => {
      handleCloseTile(tileId);
      setMenuOpen(false);
    },
    [handleCloseTile, setMenuOpen],
  );

  // Tabs only appear once there's more than one open; a lone agent view needs no strip.
  if (isMobile || openTabs.length <= 1) return null;

  return (
    <div className="flex min-w-0 items-center gap-1 overflow-x-auto">
      {openTabs.map((tileId) => {
        const isVisible = visibleSet.has(tileId);
        const { name, kind } = tabParts(tileId, primaryTitle, secondaryTitle);
        return (
          <div
            key={tileId}
            onContextMenu={(e) => {
              e.preventDefault();
              openMenu(tileId, e.currentTarget);
            }}
            className={cn(
              'flex min-w-0 max-w-[220px] items-center gap-1 rounded-md py-1 pl-2.5 pr-1',
              'transition-colors duration-200',
              isVisible
                ? 'bg-surface-active text-text-primary dark:bg-surface-dark-active dark:text-text-dark-primary'
                : 'text-text-tertiary hover:bg-surface-hover hover:text-text-primary dark:text-text-dark-tertiary dark:hover:bg-surface-dark-hover dark:hover:text-text-dark-primary',
            )}
          >
            <Button
              variant="unstyled"
              onClick={() => useUIStore.getState().activateTab(tileId)}
              className="flex min-w-0 flex-1 items-center text-left text-2xs font-medium"
              title={kind ? `${name} · ${kind}` : name}
            >
              <span className="min-w-0 truncate">{name}</span>
              {kind && (
                <span className="ml-1 flex-shrink-0 text-text-tertiary dark:text-text-dark-tertiary">
                  · {kind}
                </span>
              )}
            </Button>
            <Button
              variant="unstyled"
              onClick={(e) => openMenu(tileId, e.currentTarget)}
              className={TAB_BUTTON_CLASS}
              title="Tab options"
            >
              <MoreHorizontal className="h-3 w-3" />
            </Button>
          </div>
        );
      })}
      {menuOpen &&
        menu &&
        createPortal(
          <div
            ref={menuRef}
            style={{ position: 'fixed', top: menu.top, right: menu.right }}
            className="z-[70] min-w-[148px] rounded-xl border border-border bg-surface-secondary/95 p-1 shadow-medium backdrop-blur-xl dark:border-border-dark dark:bg-surface-dark-secondary/95"
          >
            <Button
              variant="unstyled"
              onClick={() => handleSplit('row', menu.tileId)}
              className={MENU_ITEM_CLASS}
            >
              <PanelRight className="h-3 w-3" />
              Split right
            </Button>
            <Button
              variant="unstyled"
              onClick={() => handleSplit('column', menu.tileId)}
              className={MENU_ITEM_CLASS}
            >
              <PanelBottom className="h-3 w-3" />
              Split bottom
            </Button>
            {/* The base agent tab can't close, except in a split where closing it
                promotes the secondary chat to primary. */}
            {(menu.tileId !== 'agent:primary' || !!secondaryChatId) && (
              <Button
                variant="unstyled"
                onClick={() => handleCloseFromMenu(menu.tileId)}
                className={MENU_ITEM_CLASS}
              >
                <X className="h-3 w-3" />
                Close
              </Button>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}
