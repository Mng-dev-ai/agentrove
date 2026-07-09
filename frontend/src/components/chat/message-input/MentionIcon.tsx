import { FileIcon } from '@/components/ui/shared/FileIcon/FileIcon';
import type { MentionItem } from '@/types/ui.types';

export function MentionIcon({
  name,
  className = 'h-3.5 w-3.5',
}: Pick<MentionItem, 'name'> & { className?: string }) {
  return <FileIcon name={name} className={className} />;
}
