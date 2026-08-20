import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronRight, SlidersVertical } from 'lucide-react';
import clsx from 'clsx';
import { Button } from '@/components/ui/primitives/Button/Button';
import {
  AGENT_OPTIONS,
  clearSidebarFilters,
  countActiveSidebarFilters,
  GROUP_BY_OPTIONS,
  STATUS_OPTIONS,
  type FilterCategory,
  type SidebarFilters,
  type SidebarStatusFilter,
} from '@/store/sidebarFilters';
import type { WorkspaceBadge } from '@/hooks/queries/useSidebarChatLists';
import { SidebarFilterSubmenu } from './SidebarFilterSubmenu';
import styles from './SidebarFilterMenu.module.scss';

const PANEL_WIDTH = 240;
const SUBMENU_WIDTH = 200;
// Grace delay lets the pointer cross the gap between a row and its flyout
// without the flyout closing mid-travel
const SUBMENU_GRACE_MS = 150;

// Category row on the root panel: label left, current value + chevron right.
// The value reads muted when the filter is off ("All") and emphasized when set.
function FilterCategoryRow({
  label,
  summary,
  active,
  expanded,
  onOpen,
  onLeave,
}: {
  label: string;
  summary: string;
  active: boolean;
  expanded: boolean;
  onOpen: (e: React.MouseEvent<HTMLButtonElement>) => void;
  onLeave: () => void;
}) {
  return (
    <Button
      variant="unstyled"
      onClick={onOpen}
      onMouseEnter={onOpen}
      onMouseLeave={onLeave}
      aria-haspopup="menu"
      aria-expanded={expanded}
      className={styles['category-row']}
    >
      {label}
      <span className={styles['category-value']}>
        <span
          className={clsx(styles['category-summary'], active && styles['category-summary--active'])}
        >
          {summary}
        </span>
        <ChevronRight className={styles['category-chevron']} />
      </span>
    </Button>
  );
}

interface SidebarFilterMenuProps {
  filters: SidebarFilters;
  onChange: (filters: SidebarFilters) => void;
  workspaceBadgeById: Map<string, WorkspaceBadge>;
}

export function SidebarFilterMenu({
  filters,
  onChange,
  workspaceBadgeById,
}: SidebarFilterMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [submenu, setSubmenu] = useState<{
    view: FilterCategory;
    top: number;
    left: number;
    maxHeight: number;
  } | null>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const submenuRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<number | null>(null);
  // Fixed positioning keeps the panel out of the scroll container's clipping;
  // captured on open from the trigger rect, right-aligned to it.
  const [position, setPosition] = useState({ top: 0, right: 0, maxHeight: 0 });
  const activeCount = countActiveSidebarFilters(filters);

  const cancelSubmenuClose = () => {
    if (closeTimerRef.current != null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };

  const scheduleSubmenuClose = () => {
    cancelSubmenuClose();
    closeTimerRef.current = window.setTimeout(() => setSubmenu(null), SUBMENU_GRACE_MS);
  };

  const closeAll = () => {
    cancelSubmenuClose();
    setSubmenu(null);
    setIsOpen(false);
  };

  const openSubmenu = (view: FilterCategory, e: React.MouseEvent<HTMLButtonElement>) => {
    cancelSubmenuClose();
    const rect = e.currentTarget.getBoundingClientRect();
    // Flip to the panel's left when the flyout would overflow the viewport;
    // on narrow (mobile) viewports neither side fits, so clamp on-screen —
    // overlapping the root panel beats rendering off the left edge
    const left =
      rect.right + 10 + SUBMENU_WIDTH <= window.innerWidth
        ? rect.right + 10
        : Math.max(
            8,
            Math.min(rect.left - SUBMENU_WIDTH - 10, window.innerWidth - SUBMENU_WIDTH - 8),
          );
    const top = Math.max(8, rect.top - 6);
    setSubmenu({ view, top, left, maxHeight: window.innerHeight - top - 8 });
  };

  const handleToggle = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (isOpen) {
      closeAll();
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    setPosition({
      top: rect.bottom + 6,
      right: Math.max(8, window.innerWidth - Math.max(rect.right, PANEL_WIDTH + 8)),
      maxHeight: window.innerHeight - rect.bottom - 14,
    });
    setIsOpen(true);
  };

  // The panel and flyout portal to body (out of this subtree), so outside-click
  // must check all three refs — a single-ref useDropdown would treat every
  // panel/flyout click as outside and close the menu.
  useEffect(() => {
    if (!isOpen) return;
    const handleMouseDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        triggerRef.current?.contains(target) ||
        panelRef.current?.contains(target) ||
        submenuRef.current?.contains(target)
      ) {
        return;
      }
      cancelSubmenuClose();
      setSubmenu(null);
      setIsOpen(false);
    };
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [isOpen]);

  // Scrolling the chat list detaches the fixed panel from its trigger — close it.
  // Scrolls inside the panel or flyout (workspace list) keep it open.
  useEffect(() => {
    if (!isOpen) return;
    const handleScroll = (e: Event) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target) || submenuRef.current?.contains(target)) return;
      cancelSubmenuClose();
      setSubmenu(null);
      setIsOpen(false);
    };
    window.addEventListener('scroll', handleScroll, true);
    return () => window.removeEventListener('scroll', handleScroll, true);
  }, [isOpen]);

  // Single-select options close their flyout; the root panel stays open with
  // the updated summary. Multi-select status stays put for further toggles.
  const selectAndClose = (patch: Partial<SidebarFilters>) => {
    onChange({ ...filters, ...patch });
    setSubmenu(null);
  };

  const toggleStatus = (status: SidebarStatusFilter) => {
    const statuses = filters.statuses.includes(status)
      ? filters.statuses.filter((s) => s !== status)
      : [...filters.statuses, status];
    onChange({ ...filters, statuses });
  };

  // The badge map is the single owner of the local+cloud workspace merge; the
  // picker just flattens it (insertion order: local first, then cloud).
  const workspaceOptions = useMemo(
    () =>
      Array.from(workspaceBadgeById, ([id, badge]) => ({
        id,
        name: badge.name,
        isCloud: badge.isCloud,
      })),
    [workspaceBadgeById],
  );

  const statusSummary =
    filters.statuses.length === 0
      ? 'All'
      : filters.statuses.length === 1
        ? (STATUS_OPTIONS.find((o) => o.value === filters.statuses[0])?.label ?? 'All')
        : `${filters.statuses.length} selected`;
  const agentSummary = filters.agentKind
    ? (AGENT_OPTIONS.find((o) => o.value === filters.agentKind)?.label ?? 'All')
    : 'All';
  const sourceSummary =
    filters.source === 'all' ? 'All' : filters.source === 'local' ? 'Local' : 'Cloud';
  // The name can be briefly unresolved while the cloud workspaces query loads
  const workspaceSummary = filters.workspaceId
    ? (workspaceOptions.find((w) => w.id === filters.workspaceId)?.name ?? '1 selected')
    : 'All';
  const groupBySummary = GROUP_BY_OPTIONS.find((o) => o.value === filters.groupBy)?.label ?? 'None';

  return (
    <div ref={triggerRef} className={styles['filter-menu']}>
      <Button
        variant="unstyled"
        onClick={handleToggle}
        aria-label="Filter chats"
        aria-expanded={isOpen}
        className={clsx(styles.trigger, (activeCount > 0 || isOpen) && styles['trigger--active'])}
      >
        <SlidersVertical className={styles['trigger-icon']} />
        {activeCount > 0 && <span className={styles.count}>{activeCount}</span>}
      </Button>

      {/* Portal to body: the sliding sidebar's transform re-anchors position:fixed
          (see FloatingTooltip), which would push the panel off-screen */}
      {isOpen &&
        createPortal(
          <>
            <div
              ref={panelRef}
              onMouseLeave={scheduleSubmenuClose}
              className={styles.panel}
              style={{
                top: position.top,
                right: position.right,
                maxHeight: position.maxHeight,
                width: PANEL_WIDTH,
              }}
            >
              <FilterCategoryRow
                label="Status"
                summary={statusSummary}
                active={filters.statuses.length > 0}
                expanded={submenu?.view === 'status'}
                onOpen={(e) => openSubmenu('status', e)}
                onLeave={scheduleSubmenuClose}
              />
              <FilterCategoryRow
                label="Agent"
                summary={agentSummary}
                active={filters.agentKind !== null}
                expanded={submenu?.view === 'agent'}
                onOpen={(e) => openSubmenu('agent', e)}
                onLeave={scheduleSubmenuClose}
              />
              <FilterCategoryRow
                label="Source"
                summary={sourceSummary}
                active={filters.source !== 'all'}
                expanded={submenu?.view === 'source'}
                onOpen={(e) => openSubmenu('source', e)}
                onLeave={scheduleSubmenuClose}
              />
              <FilterCategoryRow
                label="Workspace"
                summary={workspaceSummary}
                active={filters.workspaceId !== null}
                expanded={submenu?.view === 'workspace'}
                onOpen={(e) => openSubmenu('workspace', e)}
                onLeave={scheduleSubmenuClose}
              />
              {/* Divider sets grouping apart from the rows above — it changes
                  presentation, not which chats show */}
              <div className={styles.divider}>
                <FilterCategoryRow
                  label="Group by"
                  summary={groupBySummary}
                  active={filters.groupBy !== 'none'}
                  expanded={submenu?.view === 'groupBy'}
                  onOpen={(e) => openSubmenu('groupBy', e)}
                  onLeave={scheduleSubmenuClose}
                />
              </div>
              {activeCount > 0 && (
                <div className={styles.divider}>
                  <Button
                    variant="unstyled"
                    onClick={() => onChange(clearSidebarFilters(filters))}
                    className={styles['clear-all']}
                  >
                    Clear all filters
                  </Button>
                </div>
              )}
            </div>

            {submenu && (
              <SidebarFilterSubmenu
                view={submenu.view}
                filters={filters}
                workspaceOptions={workspaceOptions}
                submenuRef={submenuRef}
                style={{
                  top: submenu.top,
                  left: submenu.left,
                  maxHeight: submenu.maxHeight,
                  width: SUBMENU_WIDTH,
                }}
                onMouseEnter={cancelSubmenuClose}
                onMouseLeave={scheduleSubmenuClose}
                onChange={onChange}
                onToggleStatus={toggleStatus}
                onSelectAndClose={selectAndClose}
              />
            )}
          </>,
          document.body,
        )}
    </div>
  );
}
