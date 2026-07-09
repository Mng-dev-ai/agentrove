import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronRight, Cloud, SlidersVertical } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button/Button';
import { ProviderIcon } from '@/components/ui/icons/ProviderIcon';
import { cn } from '@/utils/cn';
import {
  clearSidebarFilters,
  countActiveSidebarFilters,
  type SidebarFilters,
  type SidebarGroupBy,
  type SidebarStatusFilter,
} from '@/store/sidebarFilters';
import type { AgentKind } from '@/types/chat.types';
import type { WorkspaceBadge } from '@/hooks/queries/useSidebarChatLists';

const STATUS_OPTIONS: { value: SidebarStatusFilter; label: string }[] = [
  { value: 'unread', label: 'Unread' },
  { value: 'running', label: 'Running' },
  { value: 'done', label: 'Done' },
  { value: 'needs-you', label: 'Needs you' },
];

// Labels match the ModelSelector agent group headers
const AGENT_OPTIONS: { value: AgentKind; label: string }[] = [
  { value: 'claude', label: 'Claude' },
  { value: 'codex', label: 'Codex' },
  { value: 'copilot', label: 'Copilot' },
  { value: 'cursor', label: 'Cursor' },
  { value: 'opencode', label: 'OpenCode' },
];

const GROUP_BY_OPTIONS: { value: SidebarGroupBy; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'workspace', label: 'Workspace' },
  { value: 'status', label: 'Status' },
];

const PANEL_WIDTH = 240;
const SUBMENU_WIDTH = 200;
// Grace delay lets the pointer cross the gap between a row and its flyout
// without the flyout closing mid-travel
const SUBMENU_GRACE_MS = 150;

// Category flyouts: hovering (or clicking, for touch) a root row opens its
// option list beside the panel.
type FilterCategory = 'status' | 'agent' | 'source' | 'workspace' | 'groupBy';

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
      className={cn(
        'flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-xs text-text-primary transition-colors duration-200 hover:bg-surface-hover dark:text-text-dark-primary dark:hover:bg-surface-dark-hover',
        expanded && 'bg-surface-hover dark:bg-surface-dark-hover',
      )}
    >
      {label}
      <span className="flex min-w-0 items-center gap-1">
        <span
          className={cn(
            'truncate',
            active
              ? 'font-medium text-text-primary dark:text-text-dark-primary'
              : 'text-text-quaternary dark:text-text-dark-quaternary',
          )}
        >
          {summary}
        </span>
        <ChevronRight className="h-3 w-3 flex-shrink-0 text-text-quaternary dark:text-text-dark-quaternary" />
      </span>
    </Button>
  );
}

// Option row in a category flyout: label left, check right when selected.
function FilterOptionRow({
  selected,
  onSelect,
  children,
}: {
  selected: boolean;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <Button
      variant="unstyled"
      onClick={onSelect}
      className={cn(
        'flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors duration-200 hover:bg-surface-hover dark:hover:bg-surface-dark-hover',
        selected
          ? 'font-medium text-text-primary dark:text-text-dark-primary'
          : 'text-text-secondary dark:text-text-dark-secondary',
      )}
    >
      <span className="flex min-w-0 items-center gap-1.5">{children}</span>
      {selected && <Check className="h-3 w-3 flex-shrink-0" />}
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
    <div ref={triggerRef} className="flex items-center">
      <Button
        variant="unstyled"
        onClick={handleToggle}
        aria-label="Filter chats"
        aria-expanded={isOpen}
        // -m-1/p-1 keeps a comfortable hit target without inflating the header row
        className={cn(
          '-m-1 flex items-center gap-1 rounded-md p-1 transition-colors duration-200 hover:text-text-primary dark:hover:text-text-dark-primary',
          activeCount > 0 || isOpen
            ? 'text-text-primary dark:text-text-dark-primary'
            : 'text-text-quaternary dark:text-text-dark-quaternary',
        )}
      >
        <SlidersVertical className="h-3.5 w-3.5" />
        {activeCount > 0 && (
          <span className="text-[10px] font-medium tabular-nums">{activeCount}</span>
        )}
      </Button>

      {/* Portal to body: the sliding sidebar's transform re-anchors position:fixed
          (see FloatingTooltip), which would push the panel off-screen */}
      {isOpen &&
        createPortal(
          <>
            <div
              ref={panelRef}
              onMouseLeave={scheduleSubmenuClose}
              className="fixed z-50 overflow-y-auto rounded-xl border border-border/50 bg-surface-secondary/95 p-1.5 shadow-medium backdrop-blur-xl dark:border-border-dark/50 dark:bg-surface-dark-secondary/95"
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
              <div className="mt-1.5 border-t border-border/50 pt-1.5 dark:border-border-dark/50">
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
                <div className="mt-1.5 border-t border-border/50 pt-1.5 dark:border-border-dark/50">
                  <Button
                    variant="unstyled"
                    onClick={() => onChange(clearSidebarFilters(filters))}
                    className="w-full rounded-md px-2 py-1.5 text-left text-xs text-text-tertiary transition-colors duration-200 hover:bg-surface-hover hover:text-text-primary dark:text-text-dark-tertiary dark:hover:bg-surface-dark-hover dark:hover:text-text-dark-primary"
                  >
                    Clear all filters
                  </Button>
                </div>
              )}
            </div>

            {submenu && (
              <div
                ref={submenuRef}
                onMouseEnter={cancelSubmenuClose}
                onMouseLeave={scheduleSubmenuClose}
                className="fixed z-50 overflow-y-auto rounded-xl border border-border/50 bg-surface-secondary/95 p-1.5 shadow-medium backdrop-blur-xl dark:border-border-dark/50 dark:bg-surface-dark-secondary/95"
                style={{
                  top: submenu.top,
                  left: submenu.left,
                  maxHeight: submenu.maxHeight,
                  width: SUBMENU_WIDTH,
                }}
              >
                {submenu.view === 'status' && (
                  <>
                    <FilterOptionRow
                      selected={filters.statuses.length === 0}
                      onSelect={() => onChange({ ...filters, statuses: [] })}
                    >
                      All
                    </FilterOptionRow>
                    {STATUS_OPTIONS.map(({ value, label }) => (
                      <FilterOptionRow
                        key={value}
                        selected={filters.statuses.includes(value)}
                        onSelect={() => toggleStatus(value)}
                      >
                        {label}
                      </FilterOptionRow>
                    ))}
                  </>
                )}

                {submenu.view === 'agent' && (
                  <>
                    <FilterOptionRow
                      selected={filters.agentKind === null}
                      onSelect={() => selectAndClose({ agentKind: null })}
                    >
                      All
                    </FilterOptionRow>
                    {AGENT_OPTIONS.map(({ value, label }) => (
                      <FilterOptionRow
                        key={value}
                        selected={filters.agentKind === value}
                        onSelect={() => selectAndClose({ agentKind: value })}
                      >
                        <ProviderIcon agentKind={value} className="h-3 w-3 flex-shrink-0" />
                        {label}
                      </FilterOptionRow>
                    ))}
                  </>
                )}

                {submenu.view === 'source' && (
                  <>
                    <FilterOptionRow
                      selected={filters.source === 'all'}
                      onSelect={() => selectAndClose({ source: 'all' })}
                    >
                      All
                    </FilterOptionRow>
                    <FilterOptionRow
                      selected={filters.source === 'local'}
                      onSelect={() => selectAndClose({ source: 'local' })}
                    >
                      Local
                    </FilterOptionRow>
                    <FilterOptionRow
                      selected={filters.source === 'cloud'}
                      onSelect={() => selectAndClose({ source: 'cloud' })}
                    >
                      <Cloud className="h-3 w-3 flex-shrink-0" />
                      Cloud
                    </FilterOptionRow>
                  </>
                )}

                {submenu.view === 'groupBy' &&
                  GROUP_BY_OPTIONS.map(({ value, label }) => (
                    <FilterOptionRow
                      key={value}
                      selected={filters.groupBy === value}
                      onSelect={() => selectAndClose({ groupBy: value })}
                    >
                      {label}
                    </FilterOptionRow>
                  ))}

                {submenu.view === 'workspace' && (
                  <>
                    <FilterOptionRow
                      selected={filters.workspaceId === null}
                      onSelect={() => selectAndClose({ workspaceId: null })}
                    >
                      All
                    </FilterOptionRow>
                    {workspaceOptions.map((workspace) => (
                      <FilterOptionRow
                        key={workspace.id}
                        selected={filters.workspaceId === workspace.id}
                        onSelect={() => selectAndClose({ workspaceId: workspace.id })}
                      >
                        {workspace.isCloud && <Cloud className="h-3 w-3 flex-shrink-0" />}
                        <span className="truncate">{workspace.name}</span>
                      </FilterOptionRow>
                    ))}
                  </>
                )}
              </div>
            )}
          </>,
          document.body,
        )}
    </div>
  );
}
