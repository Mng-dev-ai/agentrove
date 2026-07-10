import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CornerDownLeft, Loader2, X } from 'lucide-react';
import type * as monacoNs from 'monaco-editor';
import MarkDown from '@/components/ui/markdown/MarkDown';
import { Button } from '@/components/ui/primitives/Button/Button';
import { Textarea } from '@/components/ui/primitives/Textarea/Textarea';
import { ModelSelector } from '@/components/chat/model-selector/ModelSelector';
import { useAskAboutCodeMutation } from '@/hooks/queries/useChatQueries';
import { useChatSessionState } from '@/hooks/useChatSessionContext';
import type { EditorCodeSelection } from '@/store/uiStore';
import styles from './InlineChatWidget.module.scss';

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
  const [question, setQuestion] = useState('');
  const { selectedModelId } = useChatSessionState();
  // Widget-local override falling back to the composer selection (which may
  // resolve after mount) — picking here shouldn't retarget the main chat.
  const [modelId, setModelId] = useState('');
  const effectiveModelId = modelId || selectedModelId;
  const askMutation = useAskAboutCodeMutation();

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

  const handleSubmit = () => {
    const trimmed = question.trim();
    if (!trimmed || !effectiveModelId || askMutation.isPending) return;
    askMutation.mutate({ chatId, selection, question: trimmed, modelId: effectiveModelId });
  };

  const lineRef =
    selection.startLine === selection.endLine
      ? `${selection.startLine}`
      : `${selection.startLine}-${selection.endLine}`;
  const hasResult = askMutation.isPending || askMutation.isError || askMutation.data != null;

  return createPortal(
    <div
      className={styles['inline-chat']}
      onKeyDown={(e) => {
        // Keep widget keys from falling through to Monaco's keybinding service.
        e.stopPropagation();
        // defaultPrevented = a descendant already consumed Escape (the model
        // dropdown's search closes itself) — don't also close the widget.
        if (e.key === 'Escape' && !e.defaultPrevented) handleClose();
      }}
    >
      <div className={styles['inline-chat-header']}>
        <span className={styles['inline-chat-location']}>
          {selection.path}:{lineRef}
        </span>
        <ModelSelector
          selectedModelId={effectiveModelId}
          onModelChange={setModelId}
          dropdownPosition="bottom"
          dropdownAlign="right"
          compact={false}
        />
        <Button
          type="button"
          variant="unstyled"
          onClick={handleClose}
          aria-label="Close inline chat"
          className={styles['inline-chat-close']}
        >
          <X className={styles['icon-sm']} />
        </Button>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSubmit();
        }}
        className={styles['inline-chat-form']}
      >
        <Textarea
          ref={textareaRef}
          variant="unstyled"
          rows={1}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSubmit();
            }
          }}
          placeholder="Ask about this code…"
          className={styles['inline-chat-input']}
        />
        <Button
          type="submit"
          variant="unstyled"
          disabled={!question.trim() || !effectiveModelId || askMutation.isPending}
          aria-label="Ask question"
          className={styles['inline-chat-submit']}
        >
          <CornerDownLeft className={styles['inline-chat-submit-icon']} />
        </Button>
      </form>

      {hasResult && (
        <div className={styles['inline-chat-result']}>
          {askMutation.isPending && (
            <div className={styles['inline-chat-status']}>
              <Loader2 className={styles['inline-chat-spinner']} />
              Thinking…
            </div>
          )}
          {askMutation.isError && (
            <div className={styles['inline-chat-error']}>{askMutation.error.message}</div>
          )}
          {!askMutation.isPending && askMutation.data != null && (
            <MarkDown content={askMutation.data} />
          )}
        </div>
      )}
    </div>,
    widgetNode,
  );
}
