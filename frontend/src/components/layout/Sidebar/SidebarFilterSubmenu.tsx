import { Server } from 'lucide-react';
import { FilterOptionRow } from '@/components/ui/FilterMenu/FilterMenu';
import { ProviderIcon } from '@/components/ui/icons/ProviderIcon';
import {
  AGENT_OPTIONS,
  GROUP_BY_OPTIONS,
  STATUS_OPTIONS,
  type FilterCategory,
  type SidebarFilters,
  type SidebarStatusFilter,
} from '@/store/sidebarFilters';
import styles from '@/components/ui/FilterMenu/FilterMenu.module.scss';

interface WorkspaceOption {
  id: string;
  name: string;
  isRemote: boolean;
}

interface MachineOption {
  id: string;
  name: string;
}

interface SidebarFilterSubmenuProps {
  view: FilterCategory;
  filters: SidebarFilters;
  workspaceOptions: WorkspaceOption[];
  machineOptions: MachineOption[];
  submenuRef: React.Ref<HTMLDivElement>;
  style: React.CSSProperties;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onChange: (filters: SidebarFilters) => void;
  onToggleStatus: (status: SidebarStatusFilter) => void;
  onSelectAndClose: (patch: Partial<SidebarFilters>) => void;
}

export function SidebarFilterSubmenu({
  view,
  filters,
  workspaceOptions,
  machineOptions,
  submenuRef,
  style,
  onMouseEnter,
  onMouseLeave,
  onChange,
  onToggleStatus,
  onSelectAndClose,
}: SidebarFilterSubmenuProps) {
  return (
    <div
      ref={submenuRef}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className={styles.panel}
      style={style}
    >
      {view === 'status' && (
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
              onSelect={() => onToggleStatus(value)}
            >
              {label}
            </FilterOptionRow>
          ))}
        </>
      )}

      {view === 'agent' && (
        <>
          <FilterOptionRow
            selected={filters.agentKind === null}
            onSelect={() => onSelectAndClose({ agentKind: null })}
          >
            All
          </FilterOptionRow>
          {AGENT_OPTIONS.map(({ value, label }) => (
            <FilterOptionRow
              key={value}
              selected={filters.agentKind === value}
              onSelect={() => onSelectAndClose({ agentKind: value })}
            >
              <ProviderIcon agentKind={value} className={styles['option-icon']} />
              {label}
            </FilterOptionRow>
          ))}
        </>
      )}

      {view === 'source' && (
        <>
          <FilterOptionRow
            selected={filters.source === 'all'}
            onSelect={() => onSelectAndClose({ source: 'all' })}
          >
            All
          </FilterOptionRow>
          {machineOptions.map((machine) => (
            <FilterOptionRow
              key={machine.id}
              selected={filters.source === machine.id}
              onSelect={() => onSelectAndClose({ source: machine.id })}
            >
              <Server className={styles['option-icon']} />
              <span className={styles['option-name']}>{machine.name}</span>
            </FilterOptionRow>
          ))}
        </>
      )}

      {view === 'groupBy' &&
        GROUP_BY_OPTIONS.map(({ value, label }) => (
          <FilterOptionRow
            key={value}
            selected={filters.groupBy === value}
            onSelect={() => onSelectAndClose({ groupBy: value })}
          >
            {label}
          </FilterOptionRow>
        ))}

      {view === 'workspace' && (
        <>
          <FilterOptionRow
            selected={filters.workspaceId === null}
            onSelect={() => onSelectAndClose({ workspaceId: null })}
          >
            All
          </FilterOptionRow>
          {workspaceOptions.map((workspace) => (
            <FilterOptionRow
              key={workspace.id}
              selected={filters.workspaceId === workspace.id}
              onSelect={() => onSelectAndClose({ workspaceId: workspace.id })}
            >
              {workspace.isRemote && <Server className={styles['option-icon']} />}
              <span className={styles['option-name']}>{workspace.name}</span>
            </FilterOptionRow>
          ))}
        </>
      )}
    </div>
  );
}
