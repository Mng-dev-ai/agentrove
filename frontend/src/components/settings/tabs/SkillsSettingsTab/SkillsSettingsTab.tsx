import type { CustomSkill } from '@/types/user.types';
import { Zap, Search, Filter, type LucideIcon } from 'lucide-react';
import { useCallback, useState } from 'react';
import clsx from 'clsx';
import { Button } from '@/components/ui/primitives/Button/Button';
import { Input } from '@/components/ui/primitives/Input/Input';
import { Select } from '@/components/ui/primitives/Select/Select';
import { SkillEditDialog } from '@/components/settings/dialogs/SkillEditDialog/SkillEditDialog';
import { SkillListItem } from '@/components/settings/SkillListItem/SkillListItem';
import { useWorkspacesList } from '@/hooks/queries/useWorkspaceQueries';
import { useSkillsQuery } from '@/hooks/queries/useSkillsQueries';
import { useSkillsFilter } from '@/hooks/useSkillsFilter';
import styles from './SkillsSettingsTab.module.scss';

interface EmptyStateProps {
  icon: LucideIcon;
  message: string;
}

// Stable empty fallback so a loading/undefined `skills` doesn't yield a new `[]`
// each render — a fresh reference retriggers useSkillsFilter's render-phase setState
// (via availableSources' useMemo) into an infinite loop while the query is in flight.
const EMPTY_SKILLS: CustomSkill[] = [];

function EmptyState({ icon: Icon, message }: EmptyStateProps) {
  return (
    <div className={styles.empty}>
      <Icon className={styles['empty-icon']} />
      <p className={styles['empty-text']}>{message}</p>
    </div>
  );
}

export function SkillsSettingsTab() {
  const workspaces = useWorkspacesList();
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string>();
  // Skills are per-workspace, so default to the first workspace until the user
  // picks another instead of tracking selection in a sync effect.
  const workspaceId = selectedWorkspaceId ?? workspaces[0]?.id;

  const { data: skills, isLoading, refetch } = useSkillsQuery(workspaceId);
  const items = skills ?? EMPTY_SKILLS;
  const [editingSkill, setEditingSkill] = useState<CustomSkill | null>(null);

  const {
    searchQuery,
    setSearchQuery,
    activeSources,
    toggleSource,
    availableSources,
    filteredItems,
  } = useSkillsFilter(items, workspaceId);

  const handleCloseDialog = useCallback(() => {
    setEditingSkill(null);
  }, []);

  const handleSaved = useCallback(async () => {
    await refetch();
  }, [refetch]);

  return (
    <div>
      <div className={styles.header}>
        <div className={styles['header-top']}>
          <h2 className={styles.title}>Skills</h2>
          {items.length > 0 && (
            <span className={styles.count}>
              {filteredItems.length} of {items.length}
            </span>
          )}
        </div>
        <p className={styles.description}>
          Skills available in the selected workspace, from the Claude, Codex, Copilot, Cursor, Grok,
          or OpenCode CLI.
        </p>
      </div>

      {workspaces.length === 0 ? (
        <EmptyState icon={Zap} message="No workspaces" />
      ) : (
        <>
          <div className={styles.controls}>
            <div className={styles['search-wrap']}>
              <Search className={styles['search-icon']} />
              <Input
                variant="unstyled"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search skills…"
                aria-label="Search skills"
                className={styles['search-input']}
              />
            </div>
            <div className={styles['workspace-wrap']}>
              <Select
                value={workspaceId ?? ''}
                onChange={(e) => setSelectedWorkspaceId(e.target.value)}
                aria-label="Workspace"
              >
                {workspaces.map((ws) => (
                  <option key={ws.id} value={ws.id}>
                    {ws.name}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          {availableSources.length > 1 && (
            <div className={styles.filters}>
              <Filter className={styles['filter-icon']} />
              <div className={styles['filter-list']}>
                {availableSources.map((source) => {
                  const isActive = activeSources.has(source);
                  return (
                    <Button
                      key={source}
                      type="button"
                      variant="unstyled"
                      onClick={() => toggleSource(source)}
                      aria-pressed={isActive}
                      className={clsx(
                        styles['filter-chip'],
                        isActive ? styles['filter-chip--active'] : styles['filter-chip--inactive'],
                      )}
                    >
                      {source}
                    </Button>
                  );
                })}
              </div>
            </div>
          )}

          {isLoading ? (
            <div className={styles['loading-wrap']}>
              <p className={styles['loading-text']}>Loading skills…</p>
            </div>
          ) : items.length === 0 ? (
            <EmptyState icon={Zap} message="No skills installed" />
          ) : filteredItems.length === 0 ? (
            <EmptyState icon={Search} message="No skills match your filters" />
          ) : (
            <div className={styles.list}>
              {filteredItems.map((skill) => (
                <SkillListItem
                  key={`${skill.name}/${skill.sources.join(',')}`}
                  skill={skill}
                  onEdit={setEditingSkill}
                />
              ))}
            </div>
          )}
        </>
      )}

      {workspaceId && (
        <SkillEditDialog
          isOpen={editingSkill !== null}
          workspaceId={workspaceId}
          skill={editingSkill}
          onClose={handleCloseDialog}
          onSaved={handleSaved}
        />
      )}
    </div>
  );
}
