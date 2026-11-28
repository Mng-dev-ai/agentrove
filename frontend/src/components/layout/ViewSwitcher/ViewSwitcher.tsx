import { useMemo } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { Columns2, LayoutGrid } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button/Button';
import { FloatingTooltip } from '@/components/ui/FloatingTooltip/FloatingTooltip';
import menuStyles from '@/components/ui/FilterMenu/FilterMenu.module.scss';
import {
  ALL_COMMANDS,
  formatShortcut,
  SESSION_PANEL_SHORTCUT,
} from '@/components/ui/command-menu/commandRegistry';
import { SessionPanelIcon } from '@/components/ui/icons/viewIcons';
import { DROPDOWN_MARGIN } from '@/config/constants';
import { useAnchoredPanel } from '@/hooks/useAnchoredPanel';
import { useUIStore } from '@/store/uiStore';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useSessionPanelOpen } from '@/hooks/useSessionPanelOpen';
import { IS_MAC_PLATFORM } from '@/utils/platform';
import { activeSplitSlot, VIEW_ICONS, VIEW_LABELS, viewTypeToTileId } from '@/utils/tileHelpers';
import type { AgentTileId, ViewType } from '@/types/ui.types';
import styles from './ViewSwitcher.module.scss';

type SwitchableView = Exclude<ViewType, 'agent'>;

const SWITCHABLE_VIEWS: SwitchableView[] = ['diff', 'editor', 'terminal'];

// Same shortcut bindings as the command palette so the menu can't drift.
const VIEW_SHORTCUTS = new Map<ViewType, string>(
  ALL_COMMANDS.flatMap((cmd) =>
    cmd.type === 'view' ? [[cmd.id, formatShortcut(cmd.shortcut)] as const] : [],
  ),
);

const SESSION_PANEL_TOOLTIP = `Session panel · ${formatShortcut(SESSION_PANEL_SHORTCUT)}`;

const MENU_WIDTH = 200;

function menuPosition(rect: DOMRect) {
  return {
    top: rect.bottom + 4,
    left: Math.max(
      DROPDOWN_MARGIN,
      Math.min(rect.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - DROPDOWN_MARGIN),
    ),
  };
}

export function ViewSwitcher({ agentTile }: { agentTile?: AgentTileId }) {
  const activeAgentTile = useUIStore((s) => s.activeAgentTile);
  const paneTile = agentTile ?? activeAgentTile;
  const splitChatIds = useUIStore((s) => s.splitChatIds);
  const visibleLayout = useUIStore((s) => s.visibleLayout);
  const isMobile = useIsMobile();
  const sessionPanelOpen = useSessionPanelOpen(paneTile);
  const menu = useAnchoredPanel(menuPosition);
  // Phones show one view at a time; an open session panel covers the workspace.
  const panelCoversWorkspace = isMobile && sessionPanelOpen;
  // "Ctrl+Shift+D" is too long to scan in a three-row menu; the palette still lists it.
  const showShortcuts = IS_MAC_PLATFORM && !isMobile;

  // Active state matches the tile toggleView() will act on.
  const slot = activeSplitSlot(paneTile, splitChatIds);
  // Highlight = on screen; background-mounted views stay unlit (click surfaces).
  const visibleSet = useMemo(() => new Set(visibleLayout.flat()), [visibleLayout]);

  const split = (view: SwitchableView) => {
    menu.close();
    useUIStore.getState().addViewToSplit(view, 'row', paneTile);
  };

  return (
    <div className={styles['view-switcher']}>
      <FloatingTooltip content={menu.isOpen ? null : 'Views'}>
        <Button
          ref={menu.triggerRef}
          variant="unstyled"
          onClick={menu.toggle}
          className={styles['view-button']}
          aria-label="Views"
          aria-haspopup="menu"
          aria-expanded={menu.isOpen}
        >
          <LayoutGrid className={styles.icon} />
        </Button>
      </FloatingTooltip>
      {/* Portal to body: the pane header column clips overflow */}
      {menu.isOpen &&
        createPortal(
          <div
            ref={menu.panelRef}
            role="menu"
            className={menuStyles.panel}
            style={{ top: menu.pos.top, left: menu.pos.left, width: MENU_WIDTH }}
          >
            {SWITCHABLE_VIEWS.map((view) => {
              const Icon = VIEW_ICONS[view];
              const label = VIEW_LABELS[view];
              const isActive =
                !panelCoversWorkspace && visibleSet.has(viewTypeToTileId(view, slot));
              const canSplit = !isMobile && !isActive;
              return (
                <div key={view} className={clsx(styles.row, canSplit && styles['row--splittable'])}>
                  <Button
                    variant="unstyled"
                    role="menuitemcheckbox"
                    aria-checked={isActive}
                    className={styles.item}
                    // Left-click toggles full; shift/right-click splits beside the active pane.
                    onClick={(e) => {
                      if (e.shiftKey && !isMobile) {
                        split(view);
                        return;
                      }
                      menu.close();
                      useUIStore.getState().toggleView(view, true, paneTile);
                    }}
                    onContextMenu={(e) => {
                      if (isMobile) return;
                      e.preventDefault();
                      split(view);
                    }}
                  >
                    <Icon className={styles['item-icon']} />
                    {label}
                    {showShortcuts && (
                      <span className={styles.shortcut}>{VIEW_SHORTCUTS.get(view)}</span>
                    )}
                  </Button>
                  {canSplit && (
                    <Button
                      variant="unstyled"
                      className={styles.split}
                      onClick={() => split(view)}
                      aria-label={`Split ${label} view`}
                    >
                      <Columns2 className={styles['item-icon']} />
                      Split
                    </Button>
                  )}
                </div>
              );
            })}
          </div>,
          document.body,
        )}
      <FloatingTooltip content={SESSION_PANEL_TOOLTIP}>
        <Button
          variant="unstyled"
          onClick={() => useUIStore.getState().toggleSessionPanel(paneTile)}
          className={styles['view-button']}
          aria-label="Toggle session panel"
          aria-pressed={sessionPanelOpen}
        >
          <SessionPanelIcon className={styles.icon} />
        </Button>
      </FloatingTooltip>
    </div>
  );
}
