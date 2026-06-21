import type { CustomSkill } from '@/types/user.types';
import { Zap, Edit2 } from 'lucide-react';
import { useCallback, useState } from 'react';
import { Button } from '@/components/ui/primitives/Button';
import { Select } from '@/components/ui/primitives/Select';
import { SkillEditDialog } from '@/components/settings/dialogs/SkillEditDialog';
import { useWorkspacesList } from '@/hooks/queries/useWorkspaceQueries';
import { useSkillsQuery } from '@/hooks/queries/useSkillsQueries';
import { formatBytes } from '@/utils/format';

export const SkillsSettingsTab: React.FC = () => {
  const workspaces = useWorkspacesList();
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string>();
  // Skills are per-workspace, so default to the first workspace until the user
  // picks another instead of tracking selection in a sync effect.
  const workspaceId = selectedWorkspaceId ?? workspaces[0]?.id;

  const { data: skills, isLoading, refetch } = useSkillsQuery(workspaceId);
  const items = skills ?? [];
  const [editingSkill, setEditingSkill] = useState<CustomSkill | null>(null);

  const handleCloseDialog = useCallback(() => {
    setEditingSkill(null);
  }, []);

  const handleSaved = useCallback(async () => {
    await refetch();
  }, [refetch]);

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-sm font-medium text-text-primary dark:text-text-dark-primary">
          Skills
        </h2>
        <p className="mt-1 text-xs text-text-tertiary dark:text-text-dark-tertiary">
          Skills available in the selected workspace, from the Claude, Codex, Copilot, Cursor, or
          OpenCode CLI.
        </p>
      </div>

      {workspaces.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-border/50 py-10 dark:border-border-dark/50">
          <Zap className="mb-2 h-5 w-5 text-text-quaternary dark:text-text-dark-quaternary" />
          <p className="text-xs text-text-tertiary dark:text-text-dark-tertiary">No workspaces</p>
        </div>
      ) : (
        <>
          <div className="mb-4">
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

          {isLoading ? (
            <div className="flex items-center justify-center py-10">
              <p className="text-xs text-text-tertiary dark:text-text-dark-tertiary">
                Loading skills…
              </p>
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-lg border border-border/50 py-10 dark:border-border-dark/50">
              <Zap className="mb-2 h-5 w-5 text-text-quaternary dark:text-text-dark-quaternary" />
              <p className="text-xs text-text-tertiary dark:text-text-dark-tertiary">
                No skills installed
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {items.map((skill) => (
                <div
                  key={`${skill.source}/${skill.name}`}
                  className="rounded-lg border border-border/50 px-4 py-3 dark:border-border-dark/50"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex items-center gap-2">
                        <h3 className="min-w-0 max-w-full truncate text-xs font-medium text-text-primary dark:text-text-dark-primary sm:max-w-[250px]">
                          {skill.name}
                        </h3>
                        <span className="rounded-md bg-surface-tertiary px-1.5 py-0.5 text-2xs text-text-quaternary dark:bg-surface-dark-tertiary dark:text-text-dark-quaternary">
                          {skill.source}
                        </span>
                        {skill.read_only && (
                          <span className="rounded-md bg-surface-tertiary px-1.5 py-0.5 text-2xs text-text-quaternary dark:bg-surface-dark-tertiary dark:text-text-dark-quaternary">
                            built-in
                          </span>
                        )}
                      </div>
                      {skill.description && (
                        <p className="mb-2 text-xs text-text-tertiary dark:text-text-dark-tertiary">
                          {skill.description}
                        </p>
                      )}
                      <div className="flex items-center gap-2 text-2xs text-text-quaternary dark:text-text-dark-quaternary">
                        <span>
                          {skill.file_count} file{skill.file_count !== 1 ? 's' : ''}
                        </span>
                        <span className="text-border dark:text-border-dark">/</span>
                        <span>{formatBytes(skill.size_bytes)}</span>
                      </div>
                    </div>
                    {!skill.read_only && (
                      <Button
                        type="button"
                        onClick={() => setEditingSkill(skill)}
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-text-quaternary hover:text-text-secondary dark:text-text-dark-quaternary dark:hover:text-text-dark-secondary"
                        aria-label={`Edit ${skill.name}`}
                      >
                        <Edit2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
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
