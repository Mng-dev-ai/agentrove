import { useMemo } from 'react';
import { Button } from '@/components/ui/primitives/Button/Button';
import { Tooltip } from '@/components/ui/Tooltip/Tooltip';
import { ALL_COMMANDS, formatShortcut } from '@/components/ui/command-menu/commandRegistry';
import { useUIStore } from '@/store/uiStore';
import { useIsMobile } from '@/hooks/useIsMobile';
import { activeSplitSlot, VIEW_ICONS, VIEW_LABELS, viewTypeToTileId } from '@/utils/tileHelpers';
import type { ViewType } from '@/types/ui.types';
import styles from './ViewSwitcher.module.scss';

type SwitchableView = Exclude<ViewType, 'agent'>;

const SWITCHABLE_VIEWS: SwitchableView[] = ['diff', 'editor', 'terminal'];

// Same shortcut bindings as the command palette so tooltips can't drift.
const VIEW_SHORTCUTS = new Map<ViewType, string>(
  ALL_COMMANDS.flatMap((cmd) =>
    cmd.type === 'view' ? [[cmd.id, formatShortcut(cmd.shortcut)] as const] : [],
  ),
);

function viewTooltip(view: SwitchableView): string {
  const shortcut = VIEW_SHORTCUTS.get(view);
  const label = shortcut ? `${VIEW_LABELS[view]} · ${shortcut}` : VIEW_LABELS[view];
  return `${label} · ⇧-click or right-click to split`;
}

export function ViewSwitcher() {
  const activeAgentTile = useUIStore((s) => s.activeAgentTile);
  const splitChatIds = useUIStore((s) => s.splitChatIds);
  const visibleLayout = useUIStore((s) => s.visibleLayout);
  const isMobile = useIsMobile();

  // Active state matches the tile toggleView() will act on (focused split pane).
  const slot = activeSplitSlot(activeAgentTile, splitChatIds);
  // Highlight = on screen; background-mounted views stay unlit (click surfaces).
  const visibleSet = useMemo(() => new Set(visibleLayout.flat()), [visibleLayout]);

  return (
    <div className={styles['view-switcher']}>
      {SWITCHABLE_VIEWS.map((view) => {
        const Icon = VIEW_ICONS[view];
        const isActive = visibleSet.has(viewTypeToTileId(view, slot));
        return (
          <Tooltip key={view} content={viewTooltip(view)} position="bottom-end">
            <Button
              variant="unstyled"
              // Left-click toggles full; shift/right-click splits beside the active pane.
              onClick={(e) => {
                if (e.shiftKey && !isMobile) {
                  useUIStore.getState().addViewToSplit(view, 'row');
                  return;
                }
                useUIStore.getState().toggleView(view, true);
              }}
              onContextMenu={(e) => {
                // Splitting is a desktop layout; leave the native long-press menu
                // alone on mobile, where the workspace is single-pane anyway.
                if (isMobile) return;
                e.preventDefault();
                useUIStore.getState().addViewToSplit(view, 'row');
              }}
              className={styles['view-button']}
              aria-label={`Toggle ${VIEW_LABELS[view]} view`}
              aria-pressed={isActive}
            >
              <Icon className={styles.icon} />
            </Button>
          </Tooltip>
        );
      })}
    </div>
  );
}
