import { useMemo } from 'react';
import { useMatch } from 'react-router-dom';
import { PanelRight } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button/Button';
import { FloatingTooltip } from '@/components/ui/FloatingTooltip/FloatingTooltip';
import {
  ALL_COMMANDS,
  formatShortcut,
  SESSION_PANEL_SHORTCUT,
} from '@/components/ui/command-menu/commandRegistry';
import { useUIStore } from '@/store/uiStore';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useSessionPanelOpen } from '@/hooks/useSessionPanelOpen';
import { activeSplitSlot, VIEW_ICONS, VIEW_LABELS, viewTypeToTileId } from '@/utils/tileHelpers';
import type { AgentTileId, ViewType } from '@/types/ui.types';
import styles from './ViewSwitcher.module.scss';

type SwitchableView = Exclude<ViewType, 'agent'>;

const SWITCHABLE_VIEWS: SwitchableView[] = ['diff', 'editor', 'terminal'];

// Same shortcut bindings as the command palette so tooltips can't drift.
const VIEW_SHORTCUTS = new Map<ViewType, string>(
  ALL_COMMANDS.flatMap((cmd) =>
    cmd.type === 'view' ? [[cmd.id, formatShortcut(cmd.shortcut)] as const] : [],
  ),
);

const SESSION_PANEL_TOOLTIP = `Session panel · ${formatShortcut(SESSION_PANEL_SHORTCUT)}`;

function viewTooltip(view: SwitchableView): string {
  const shortcut = VIEW_SHORTCUTS.get(view);
  const label = shortcut ? `${VIEW_LABELS[view]} · ${shortcut}` : VIEW_LABELS[view];
  return `${label} · ⇧-click or right-click to split`;
}

export function ViewSwitcher({ agentTile }: { agentTile?: AgentTileId }) {
  const activeAgentTile = useUIStore((s) => s.activeAgentTile);
  const paneTile = agentTile ?? activeAgentTile;
  const splitChatIds = useUIStore((s) => s.splitChatIds);
  const visibleLayout = useUIStore((s) => s.visibleLayout);
  const isLandingPage = useMatch('/');
  const isMobile = useIsMobile();
  const sessionPanelOpen = useSessionPanelOpen();
  // Phones show one view at a time; an open session panel covers the workspace.
  const panelCoversWorkspace = isMobile && sessionPanelOpen;

  // Active state matches the tile toggleView() will act on.
  const slot = activeSplitSlot(paneTile, splitChatIds);
  // Highlight = on screen; background-mounted views stay unlit (click surfaces).
  const visibleSet = useMemo(() => new Set(visibleLayout.flat()), [visibleLayout]);

  return (
    <div className={styles['view-switcher']}>
      {SWITCHABLE_VIEWS.map((view) => {
        const Icon = VIEW_ICONS[view];
        const isActive = !panelCoversWorkspace && visibleSet.has(viewTypeToTileId(view, slot));
        return (
          <FloatingTooltip
            key={view}
            content={viewTooltip(view)}
            className={view === 'diff' ? undefined : styles['view-button--collapsible']}
          >
            <Button
              variant="unstyled"
              // Left-click toggles full; shift/right-click splits beside the active pane.
              onClick={(e) => {
                if (e.shiftKey && !isMobile) {
                  useUIStore.getState().addViewToSplit(view, 'row', paneTile);
                  return;
                }
                useUIStore.getState().toggleView(view, true, paneTile);
              }}
              onContextMenu={(e) => {
                // Splitting is a desktop layout; leave the native long-press menu
                // alone on mobile, where the workspace is single-pane anyway.
                if (isMobile) return;
                e.preventDefault();
                useUIStore.getState().addViewToSplit(view, 'row', paneTile);
              }}
              className={styles['view-button']}
              aria-label={`Toggle ${VIEW_LABELS[view]} view`}
              aria-pressed={isActive}
            >
              <Icon className={styles.icon} />
            </Button>
          </FloatingTooltip>
        );
      })}
      {!isLandingPage && (
        <FloatingTooltip content={SESSION_PANEL_TOOLTIP}>
          <Button
            variant="unstyled"
            onClick={() => useUIStore.getState().toggleSessionPanel(paneTile)}
            className={styles['view-button']}
            aria-label="Toggle session panel"
            aria-pressed={sessionPanelOpen && activeAgentTile === paneTile}
          >
            <PanelRight className={styles.icon} />
          </Button>
        </FloatingTooltip>
      )}
    </div>
  );
}
