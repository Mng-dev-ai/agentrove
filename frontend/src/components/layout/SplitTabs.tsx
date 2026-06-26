import { useCallback, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { X, Maximize2, Minimize2 } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button';
import { useUIStore } from '@/store/uiStore';
import { useChatStore } from '@/store/chatStore';
import { useChatQuery } from '@/hooks/queries/useChatQueries';
import { useIsMobile } from '@/hooks/useIsMobile';
import { cn } from '@/utils/cn';
import {
  getLeaves,
  isMosaicSplitNode,
  tileIdToViewType,
  VIEW_LABELS,
  VIEW_TYPES,
} from '@/utils/mosaicHelpers';
import type { MosaicTileId } from '@/types/ui.types';

const TAB_BUTTON_CLASS = cn(
  'flex items-center justify-center',
  'h-5 w-4 rounded-md',
  'text-text-tertiary dark:text-text-dark-tertiary',
  'hover:text-text-primary dark:hover:text-text-dark-primary',
  'transition-colors duration-200',
);

function getTileLabel(
  tileId: MosaicTileId,
  agentTitles: Partial<Record<MosaicTileId, string>>,
): string {
  return agentTitles[tileId] ?? VIEW_LABELS[tileIdToViewType(tileId)] ?? tileId;
}

// Pane tabs rendered inside the title bar. One segment per split pane, with
// focus / maximize / close — replaces the per-pane window chrome. Self-sourcing:
// everything it shows is globally reachable, so no props are threaded from the page.
export function SplitTabs() {
  const { chatId } = useParams();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const mosaicLayout = useUIStore((s) => s.mosaicLayout);
  const focusedTile = useUIStore((s) => s.focusedTile);
  const rawMaximized = useUIStore((s) => s.maximizedTile);
  const secondaryChatId = useUIStore((s) => s.secondaryChatId);
  const currentChat = useChatStore((s) => s.currentChat);
  // Shares the chat-query cache with AgentPane / the page; used only for the
  // secondary pane's tab label.
  const secondaryTitle = useChatQuery(secondaryChatId ?? undefined).data?.title;

  const agentTitles = useMemo<Partial<Record<MosaicTileId, string>>>(() => {
    const titles: Partial<Record<MosaicTileId, string>> = {};
    // Only the routed chat owns a title; on the landing split currentChat may be
    // stale, so fall back to the generic view label there.
    const primaryTitle = chatId ? currentChat?.title : undefined;
    if (primaryTitle) titles['agent:primary'] = primaryTitle;
    if (secondaryChatId && secondaryTitle) {
      titles['agent:secondary'] = secondaryTitle;
      // Each non-agent view's two tiles can coexist in split-chat view — name
      // them by chat so the two copies (primary/secondary) are distinguishable.
      for (const view of VIEW_TYPES) {
        if (view === 'agent') continue;
        if (primaryTitle) titles[view] = `${primaryTitle} · ${VIEW_LABELS[view]}`;
        titles[`${view}:secondary`] = `${secondaryTitle} · ${VIEW_LABELS[view]}`;
      }
    }
    return titles;
  }, [chatId, currentChat?.title, secondaryChatId, secondaryTitle]);

  const handleCloseTile = useCallback(
    (tileId: MosaicTileId) => {
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
      ui.removeTileFromMosaic(tileId);
    },
    [chatId, navigate],
  );

  // Mirror the condition that mounts MosaicSplitView, so tabs only show when a
  // real split is on screen (single-view and mobile render no split chrome).
  const leaves = useMemo(
    () => (mosaicLayout && isMosaicSplitNode(mosaicLayout) ? getLeaves(mosaicLayout) : []),
    [mosaicLayout],
  );

  if (isMobile || leaves.length <= 1) return null;

  // Both ephemeral tile pointers are derived on read: a value that's no longer a
  // leaf is treated as absent, so the store never has to chase layout changes.
  // Before the user touches a pane, highlight the first so one tab always reads active.
  const activeTile = focusedTile && leaves.includes(focusedTile) ? focusedTile : leaves[0];
  const maximizedTile = rawMaximized && leaves.includes(rawMaximized) ? rawMaximized : null;

  return (
    <div className="flex min-w-0 items-center gap-1 overflow-x-auto">
      {leaves.map((tileId) => {
        const isFocused = tileId === activeTile;
        const isMaximized = maximizedTile === tileId;
        return (
          <div
            key={tileId}
            className={cn(
              'flex min-w-0 max-w-[220px] items-center gap-1.5 rounded-md py-1 pl-2.5 pr-1',
              'transition-colors duration-200',
              isFocused
                ? 'bg-surface-active text-text-primary dark:bg-surface-dark-active dark:text-text-dark-primary'
                : 'text-text-tertiary hover:bg-surface-hover hover:text-text-primary dark:text-text-dark-tertiary dark:hover:bg-surface-dark-hover dark:hover:text-text-dark-primary',
            )}
          >
            <Button
              variant="unstyled"
              onClick={() => useUIStore.getState().focusTile(tileId)}
              className="min-w-0 flex-1 truncate text-left text-2xs font-medium"
              title={getTileLabel(tileId, agentTitles)}
            >
              {getTileLabel(tileId, agentTitles)}
            </Button>
            <div className="flex items-center">
              <Button
                variant="unstyled"
                onClick={() => useUIStore.getState().setMaximizedTile(isMaximized ? null : tileId)}
                className={TAB_BUTTON_CLASS}
                title={isMaximized ? 'Restore split' : 'Maximize'}
              >
                {isMaximized ? (
                  <Minimize2 className="h-3 w-3" />
                ) : (
                  <Maximize2 className="h-3 w-3" />
                )}
              </Button>
              {!maximizedTile && (
                <Button
                  variant="unstyled"
                  onClick={() => handleCloseTile(tileId)}
                  className={TAB_BUTTON_CLASS}
                  title="Close tile"
                >
                  <X className="h-3 w-3" />
                </Button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
