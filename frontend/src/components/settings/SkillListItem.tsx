import type { CustomSkill } from '@/types/user.types';
import { Edit2 } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button/Button';
import { formatBytes } from '@/utils/format';

interface SkillListItemProps {
  skill: CustomSkill;
  onEdit: (skill: CustomSkill) => void;
}

export const SkillListItem: React.FC<SkillListItemProps> = ({ skill, onEdit }) => {
  return (
    <div className="rounded-lg border border-border/50 px-4 py-3 dark:border-border-dark/50">
      <div className="mb-1 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <h3 className="truncate text-xs font-medium text-text-primary dark:text-text-dark-primary">
            {skill.name}
          </h3>
          {skill.read_only && (
            <span className="shrink-0 rounded-md bg-surface-tertiary px-1.5 py-0.5 text-2xs text-text-quaternary dark:bg-surface-dark-tertiary dark:text-text-dark-quaternary">
              built-in
            </span>
          )}
        </div>
        {!skill.read_only && (
          <Button
            type="button"
            onClick={() => onEdit(skill)}
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0 text-text-quaternary hover:text-text-secondary dark:text-text-dark-quaternary dark:hover:text-text-dark-secondary"
            aria-label={`Edit ${skill.name}`}
          >
            <Edit2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
      {skill.description && (
        <p className="mb-2 text-xs text-text-tertiary dark:text-text-dark-tertiary">
          {skill.description}
        </p>
      )}
      {/* Sources sit on the meta line with file/size so the title row stays clean. */}
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-2xs text-text-quaternary dark:text-text-dark-quaternary">
        <span>{skill.sources.join(' · ')}</span>
        <span className="text-border dark:text-border-dark">·</span>
        <span>
          {skill.file_count} file{skill.file_count !== 1 ? 's' : ''}
        </span>
        <span className="text-border dark:text-border-dark">·</span>
        <span>{formatBytes(skill.size_bytes)}</span>
      </div>
    </div>
  );
};
