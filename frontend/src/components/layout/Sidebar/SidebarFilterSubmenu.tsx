import { type ReactNode } from 'react';
import { Check, Cloud } from 'lucide-react';
import clsx from 'clsx';
import { Button } from '@/components/ui/primitives/Button/Button';
import { ProviderIcon } from '@/components/ui/icons/ProviderIcon';
import type { SidebarFilters, SidebarGroupBy, SidebarStatusFilter } from '@/store/sidebarFilters';
import type { AgentKind } from '@/types/chat.types';
import styles from './SidebarFilterSubmenu.module.scss';

// Category flyouts: hovering (or clicking, for touch) a root row opens its
// option list beside the panel.
export type FilterCategory = 'status' | 'agent' | 'source' | 'workspace' | 'groupBy';

export const STATUS_OPTIONS: { value: SidebarStatusFilter; label: string }[] = [
  { value: 'unread', label: 'Unread' },
  { value: 'running', label: 'Running' },
  { value: 'done', label: 'Done' },
  { value: 'needs-you', label: 'Needs you' },
];

// Labels match the ModelSelector agent group headers
export const AGENT_OPTIONS: { value: AgentKind; label: string }[] = [
  { value: 'claude', label: 'Claude' },
  { value: 'codex', label: 'Codex' },
  { value: 'copilot', label: 'Copilot' },
  { value: 'cursor', label: 'Cursor' },
  { value: 'grok', label: 'Grok' },
  { value: 'opencode', label: 'OpenCode' },
];

export const GROUP_BY_OPTIONS: { value: SidebarGroupBy; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'workspace', label: 'Workspace' },
  { value: 'status', label: 'Status' },
];

interface WorkspaceOption {
  id: string;
  name: string;
  isCloud: boolean;
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
      className={clsx(styles['option-row'], selected && styles['option-row--selected'])}
    >
      <span className={styles['option-label']}>{children}</span>
      {selected && <Check className={styles['option-check']} />}
    </Button>
  );
}

interface SidebarFilterSubmenuProps {
  view: FilterCategory;
  filters: SidebarFilters;
  workspaceOptions: WorkspaceOption[];
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
          <FilterOptionRow
            selected={filters.source === 'local'}
            onSelect={() => onSelectAndClose({ source: 'local' })}
          >
            Local
          </FilterOptionRow>
          <FilterOptionRow
            selected={filters.source === 'cloud'}
            onSelect={() => onSelectAndClose({ source: 'cloud' })}
          >
            <Cloud className={styles['option-icon']} />
            Cloud
          </FilterOptionRow>
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
              {workspace.isCloud && <Cloud className={styles['option-icon']} />}
              <span className={styles['option-name']}>{workspace.name}</span>
            </FilterOptionRow>
          ))}
        </>
      )}
    </div>
  );
}
