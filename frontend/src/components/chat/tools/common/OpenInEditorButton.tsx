import React from 'react';
import { ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button/Button';
import { FloatingTooltip } from '@/components/ui/FloatingTooltip';
import { useUIStore } from '@/store/uiStore';
import { useChatContext } from '@/hooks/useChatContext';

export const OpenInEditorButton: React.FC<{ filePath: string }> = ({ filePath }) => {
  // Open into the editor of the chat this tool belongs to, not always the primary.
  const { chatId } = useChatContext();
  return (
    <FloatingTooltip content="Open in editor" className="flex">
      <Button
        type="button"
        onClick={() => useUIStore.getState().openFileInEditor(filePath, chatId)}
        variant="unstyled"
        className="rounded-sm opacity-0 transition-opacity duration-150 focus-visible:opacity-100 group-hover/tool:opacity-100"
        aria-label="Open in editor"
      >
        <ExternalLink className="h-3 w-3 text-text-tertiary hover:text-text-primary dark:text-text-dark-tertiary dark:hover:text-text-dark-primary" />
      </Button>
    </FloatingTooltip>
  );
};
