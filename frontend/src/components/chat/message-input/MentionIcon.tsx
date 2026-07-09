import { FileIcon } from '@/components/ui/shared/FileIcon/FileIcon';
import type { MentionItem } from '@/types/ui.types';
import styles from './MentionIcon.module.scss';

export function MentionIcon({
  name,
  className = styles['mention-icon'],
}: Pick<MentionItem, 'name'> & { className?: string }) {
  return <FileIcon name={name} className={className} />;
}
