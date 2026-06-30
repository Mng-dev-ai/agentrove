import { useMemo } from 'react';
import { Button } from '@/components/ui/primitives/Button';
import { Tooltip } from '@/components/ui/Tooltip';
import { ALL_COMMANDS, formatShortcut } from '@/components/ui/commandRegistry';
import { useUIStore } from '@/store/uiStore';
import { useIsMobile } from '@/hooks/useIsMobile';
import { cn } from '@/utils/cn';
import {
  isSecondaryPaneActive,
  VIEW_ICONS,
  VIEW_LABELS,
  viewTypeToTileId,
} from '@/utils/tileHelpers';
import type { ViewType } from '@/types/ui.types';

// Non-agent secondary views, in the order Cursor lays them out: diff (git),
// editor (file), terminal, secrets.
const SWITCHABLE_VIEWS: Exclude<ViewType, 'agent'>[] = ['diff', 'editor', 'terminal', 'secrets'];

// Reuse the command palette's shortcut bindings so the tooltips can't drift from
// the real keys (⌘⇧E etc.).
const VIEW_SHORTCUTS = new Map<ViewType, string>(
  ALL_COMMANDS.flatMap((cmd) =>
    cmd.type === 'view' ? [[cmd.id, formatShortcut(cmd.shortcut)] as const] : [],
  ),
);

function viewTooltip(view: Exclude<ViewType, 'agent'>): string {
  const shortcut = VIEW_SHORTCUTS.get(view);
  const label = shortcut ? `${VIEW_LABELS[view]} · ${shortcut}` : VIEW_LABELS[view];
  return `${label} · Right-click to split`;
}

export function ViewSwitcher() {
  const activeAgentTile = useUIStore((s) => s.activeAgentTile);
  const secondaryChatId = useUIStore((s) => s.secondaryChatId);
  const openTabs = useUIStore((s) => s.openTabs);
  const isMobile = useIsMobile();

  // Resolve active state against the exact tile toggleView() will act on, so the
  // highlight (and the close-on-click) tracks the focused pane in split-chat mode.
  const secondary = isSecondaryPaneActive(activeAgentTile, secondaryChatId);
  const openSet = useMemo(() => new Set(openTabs), [openTabs]);

  return (
    <div className="flex items-center gap-0.5">
      {SWITCHABLE_VIEWS.map((view) => {
        const Icon = VIEW_ICONS[view];
        const isActive = openSet.has(viewTypeToTileId(view, secondary));
        return (
          <Tooltip key={view} content={viewTooltip(view)} position="bottom-end">
            <Button
              variant="unstyled"
              // Left-click toggles the view full; right-click opens it beside the
              // active pane (the split is the hero gesture, otherwise buried in the
              // tab context menu).
              onClick={() => useUIStore.getState().toggleView(view, true)}
              onContextMenu={(e) => {
                // Splitting is a desktop layout; leave the native long-press menu
                // alone on mobile, where the workspace is single-pane anyway.
                if (isMobile) return;
                e.preventDefault();
                useUIStore.getState().addViewToSplit(view, 'row');
              }}
              className={cn(
                'rounded-md p-1.5 transition-colors duration-200',
                isActive
                  ? 'bg-surface-active text-text-primary dark:bg-surface-dark-active dark:text-text-dark-primary'
                  : 'text-text-tertiary hover:bg-surface-hover hover:text-text-primary dark:text-text-dark-quaternary dark:hover:bg-surface-dark-hover dark:hover:text-text-dark-primary',
              )}
              aria-label={`Toggle ${VIEW_LABELS[view]} view`}
              aria-pressed={isActive}
            >
              <Icon className="h-4 w-4" />
            </Button>
          </Tooltip>
        );
      })}
    </div>
  );
}
