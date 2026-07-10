import type { CustomSkill } from '@/types/user.types';
import { Edit2 } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button/Button';
import { formatBytes } from '@/utils/format';
import styles from './SkillListItem.module.scss';

interface SkillListItemProps {
  skill: CustomSkill;
  onEdit: (skill: CustomSkill) => void;
}

export function SkillListItem({ skill, onEdit }: SkillListItemProps) {
  return (
    <div className={styles['skill-list-item']}>
      <div className={styles.header}>
        <div className={styles['title-group']}>
          <h3 className={styles.title}>{skill.name}</h3>
          {skill.read_only && <span className={styles.badge}>built-in</span>}
        </div>
        {!skill.read_only && (
          <Button
            type="button"
            onClick={() => onEdit(skill)}
            variant="ghost"
            size="icon"
            className={styles['edit-button']}
            aria-label={`Edit ${skill.name}`}
          >
            <Edit2 className={styles['edit-icon']} />
          </Button>
        )}
      </div>
      {skill.description && <p className={styles.description}>{skill.description}</p>}
      {/* Sources sit on the meta line with file/size so the title row stays clean. */}
      <div className={styles.meta}>
        <span>{skill.sources.join(' · ')}</span>
        <span className={styles['meta-sep']}>·</span>
        <span>
          {skill.file_count} file{skill.file_count !== 1 ? 's' : ''}
        </span>
        <span className={styles['meta-sep']}>·</span>
        <span>{formatBytes(skill.size_bytes)}</span>
      </div>
    </div>
  );
}
