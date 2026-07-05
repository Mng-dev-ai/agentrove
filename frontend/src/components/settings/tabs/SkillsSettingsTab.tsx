import type { CustomSkill } from '@/types/user.types';
import { Zap, Search, Filter, type LucideIcon } from 'lucide-react';
import { useCallback, useState } from 'react';
import { Button } from '@/components/ui/primitives/Button';
import { Input } from '@/components/ui/primitives/Input';
import { Select } from '@/components/ui/primitives/Select';
import { SkillEditDialog } from '@/components/settings/dialogs/SkillEditDialog';
import { SkillListItem } from '@/components/settings/SkillListItem';
import { useWorkspacesList } from '@/hooks/queries/useWorkspaceQueries';
import { useSkillsQuery } from '@/hooks/queries/useSkillsQueries';
import { useSkillsFilter } from '@/hooks/useSkillsFilter';
import { cn } from '@/utils/cn';

interface EmptyStateProps {
  icon: LucideIcon;
  message: string;
}

// Stable empty fallback so a loading/undefined `skills` doesn't yield a new `[]`
// each render — a fresh reference retriggers useSkillsFilter's render-phase setState
// (via availableSources' useMemo) into an infinite loop while the query is in flight.
const EMPTY_SKILLS: CustomSkill[] = [];

const EmptyState: React.FC<EmptyStateProps> = ({ icon: Icon, message }) => (
  <div className="flex flex-col items-center justify-center rounded-lg border border-border/50 py-10 dark:border-border-dark/50">
    <Icon className="mb-2 h-5 w-5 text-text-quaternary dark:text-text-dark-quaternary" />
    <p className="text-xs text-text-tertiary dark:text-text-dark-tertiary">{message}</p>
  </div>
);

export const SkillsSettingsTab: React.FC = () => {
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
      <div className="mb-4">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-sm font-medium text-text-primary dark:text-text-dark-primary">
            Skills
          </h2>
          {items.length > 0 && (
            <span className="text-2xs text-text-quaternary dark:text-text-dark-quaternary">
              {filteredItems.length} of {items.length}
            </span>
          )}
        </div>
        <p className="mt-1 text-xs text-text-tertiary dark:text-text-dark-tertiary">
          Skills available in the selected workspace, from the Claude, Codex, Copilot, Cursor, or
          OpenCode CLI.
        </p>
      </div>

      {workspaces.length === 0 ? (
        <EmptyState icon={Zap} message="No workspaces" />
      ) : (
        <>
          <div className="mb-3 flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-quaternary dark:text-text-dark-quaternary" />
              <Input
                variant="unstyled"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search skills…"
                aria-label="Search skills"
                className="h-10 w-full rounded-lg border border-border bg-surface-tertiary pl-9 pr-3 text-sm text-text-primary outline-none placeholder:text-text-quaternary hover:border-border-hover focus-visible:border-border-hover dark:border-border-dark dark:bg-surface-dark-secondary dark:text-text-dark-primary dark:placeholder:text-text-dark-quaternary dark:hover:border-border-dark-hover dark:focus-visible:border-border-dark-hover"
              />
            </div>
            <div className="sm:w-52 sm:shrink-0">
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
            <div className="mb-4 flex items-center gap-2">
              <Filter className="h-3.5 w-3.5 shrink-0 text-text-quaternary dark:text-text-dark-quaternary" />
              <div className="flex flex-wrap gap-1.5">
                {availableSources.map((source) => {
                  const isActive = activeSources.has(source);
                  return (
                    <Button
                      key={source}
                      type="button"
                      variant="unstyled"
                      onClick={() => toggleSource(source)}
                      aria-pressed={isActive}
                      className={cn(
                        'rounded-full border px-2.5 py-1 text-2xs transition-colors duration-200',
                        isActive
                          ? 'border-transparent bg-text-primary text-surface dark:bg-text-dark-primary dark:text-surface-dark'
                          : 'border-border/50 bg-surface-secondary text-text-secondary hover:border-border-hover hover:text-text-primary dark:border-border-dark/50 dark:bg-surface-dark-secondary dark:text-text-dark-secondary dark:hover:border-border-dark-hover dark:hover:text-text-dark-primary',
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
            <div className="flex items-center justify-center py-10">
              <p className="text-xs text-text-tertiary dark:text-text-dark-tertiary">
                Loading skills…
              </p>
            </div>
          ) : items.length === 0 ? (
            <EmptyState icon={Zap} message="No skills installed" />
          ) : filteredItems.length === 0 ? (
            <EmptyState icon={Search} message="No skills match your filters" />
          ) : (
            <div className="space-y-2">
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
};
