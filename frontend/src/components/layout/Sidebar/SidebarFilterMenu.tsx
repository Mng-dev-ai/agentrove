import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { SlidersVertical } from 'lucide-react';
import clsx from 'clsx';
import { Button } from '@/components/ui/primitives/Button/Button';
import { FilterCategoryRow } from '@/components/ui/FilterMenu/FilterMenu';
import menuStyles from '@/components/ui/FilterMenu/FilterMenu.module.scss';
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
import { FILTER_PANEL_WIDTH, FILTER_SUBMENU_WIDTH, useFilterMenu } from '@/hooks/useFilterMenu';
import { LOCAL_MACHINE_ID } from '@/types/machine.types';
import { SidebarFilterSubmenu } from './SidebarFilterSubmenu';
import styles from './SidebarFilterMenu.module.scss';

interface SidebarFilterMenuProps {
  filters: SidebarFilters;
  onChange: (filters: SidebarFilters) => void;
  workspaceBadgeById: Map<string, WorkspaceBadge>;
  machineOptions: { id: string; name: string }[];
}

export function SidebarFilterMenu({
  filters,
  onChange,
  workspaceBadgeById,
  machineOptions,
}: SidebarFilterMenuProps) {
  const {
    isOpen,
    open,
    closeAll,
    submenu,
    openSubmenu,
    closeSubmenu,
    scheduleSubmenuClose,
    cancelSubmenuClose,
    triggerRef,
    panelRef,
    submenuRef,
  } = useFilterMenu<FilterCategory>();
  // Fixed positioning keeps the panel out of the scroll container's clipping;
  // captured on open from the trigger rect, right-aligned to it.
  const [position, setPosition] = useState({ top: 0, right: 0, maxHeight: 0 });
  const activeCount = countActiveSidebarFilters(filters);

  const handleToggle = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (isOpen) {
      closeAll();
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    setPosition({
      top: rect.bottom + 6,
      right: Math.max(8, window.innerWidth - Math.max(rect.right, FILTER_PANEL_WIDTH + 8)),
      maxHeight: window.innerHeight - rect.bottom - 14,
    });
    open();
  };

  // Single-select options close their flyout; the root panel stays open with
  // the updated summary. Multi-select status stays put for further toggles.
  const selectAndClose = (patch: Partial<SidebarFilters>) => {
    onChange({ ...filters, ...patch });
    closeSubmenu();
  };

  const toggleStatus = (status: SidebarStatusFilter) => {
    const statuses = filters.statuses.includes(status)
      ? filters.statuses.filter((s) => s !== status)
      : [...filters.statuses, status];
    onChange({ ...filters, statuses });
  };

  // The badge map is the single owner of the cross-machine workspace merge; the
  // picker just flattens it (insertion order: local first, then remote machines).
  const workspaceOptions = useMemo(
    () =>
      Array.from(workspaceBadgeById, ([id, badge]) => ({
        id,
        name: badge.name,
        isRemote: badge.machineId !== LOCAL_MACHINE_ID,
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
    machineOptions.find((machine) => machine.id === filters.source)?.name ?? 'All';
  // The name can be briefly unresolved while a machine's workspaces query loads
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
              className={menuStyles.panel}
              style={{
                top: position.top,
                right: position.right,
                maxHeight: position.maxHeight,
                width: FILTER_PANEL_WIDTH,
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
              <div className={menuStyles.divider}>
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
                <div className={menuStyles.divider}>
                  <Button
                    variant="unstyled"
                    onClick={() => onChange(clearSidebarFilters(filters))}
                    className={menuStyles['clear-all']}
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
                machineOptions={machineOptions}
                submenuRef={submenuRef}
                style={{
                  top: submenu.top,
                  left: submenu.left,
                  maxHeight: submenu.maxHeight,
                  width: FILTER_SUBMENU_WIDTH,
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
