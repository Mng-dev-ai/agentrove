import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type * as monacoNs from 'monaco-editor';
import { InlineAskPanel } from '@/components/chat/inline-ask/InlineAskPanel';
import type { EditorCodeSelection } from '@/store/uiStore';

type Monaco = typeof import('monaco-editor');

interface InlineChatWidgetProps {
  monaco: Monaco;
  editor: monacoNs.editor.IStandaloneCodeEditor;
  chatId: string;
  selection: EditorCodeSelection;
  onClose: () => void;
}

export function InlineChatWidget({
  monaco,
  editor,
  chatId,
  selection,
  onClose,
}: InlineChatWidgetProps) {
  // Monaco owns anchoring/scroll-tracking via the content-widget API; React
  // portals the panel into this node so it stays inside the provider tree.
  const [widgetNode] = useState(() => document.createElement('div'));
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useLayoutEffect(() => {
    const widget: monacoNs.editor.IContentWidget = {
      getId: () => 'agentrove.inlineChatWidget',
      getDomNode: () => widgetNode,
      // The panel is wider than most code lines — let it escape the scrollable
      // text area instead of being clipped at the viewport edge.
      allowEditorOverflow: true,
      getPosition: () => ({
        position: { lineNumber: selection.endLine, column: 1 },
        preference: [
          monaco.editor.ContentWidgetPositionPreference.BELOW,
          monaco.editor.ContentWidgetPositionPreference.ABOVE,
        ],
      }),
    };
    editor.addContentWidget(widget);
    editor.revealLineInCenterIfOutsideViewport(selection.endLine);
    // Focus here, not via autoFocus — React commits the portal children while
    // widgetNode is still detached, so autoFocus would no-op and leave typing
    // routed to Monaco. addContentWidget attaches the node synchronously.
    textareaRef.current?.focus();
    // Monaco's scroll handler is a bubble-phase wheel listener on the editor
    // root, which contains the overflowing-widgets layer — stop wheel events
    // here so the answer pane scrolls natively instead of the editor.
    const stopWheel = (e: WheelEvent) => e.stopPropagation();
    widgetNode.addEventListener('wheel', stopWheel);
    return () => {
      widgetNode.removeEventListener('wheel', stopWheel);
      editor.removeContentWidget(widget);
    };
  }, [monaco, editor, widgetNode, selection]);

  const handleClose = () => {
    onClose();
    editor.focus();
  };

  return createPortal(
    <InlineAskPanel
      chatId={chatId}
      selection={selection}
      inputRef={textareaRef}
      onClose={handleClose}
    />,
    widgetNode,
  );
}
