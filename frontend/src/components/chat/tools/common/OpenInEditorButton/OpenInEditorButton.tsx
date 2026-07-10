import { ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button/Button';
import { FloatingTooltip } from '@/components/ui/FloatingTooltip/FloatingTooltip';
import { useUIStore } from '@/store/uiStore';
import { useChatContext } from '@/hooks/useChatContext';
import styles from './OpenInEditorButton.module.scss';

export function OpenInEditorButton({ filePath }: { filePath: string }) {
  // Open into the editor of the chat this tool belongs to, not always the primary.
  const { chatId } = useChatContext();
  return (
    <FloatingTooltip content="Open in editor" className={styles.tooltip}>
      <Button
        type="button"
        onClick={() => useUIStore.getState().openFileInEditor(filePath, chatId)}
        variant="unstyled"
        className={styles.button}
        aria-label="Open in editor"
      >
        <ExternalLink className={styles.icon} />
      </Button>
    </FloatingTooltip>
  );
}
