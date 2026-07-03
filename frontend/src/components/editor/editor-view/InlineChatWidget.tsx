import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CornerDownLeft, Loader2, X } from 'lucide-react';
import type * as monacoNs from 'monaco-editor';
import MarkDown from '@/components/ui/MarkDown';
import { Button } from '@/components/ui/primitives/Button';
import { Textarea } from '@/components/ui/primitives/Textarea';
import { ModelSelector } from '@/components/chat/model-selector/ModelSelector';
import { useAskAboutCodeMutation } from '@/hooks/queries/useChatQueries';
import { useChatSessionState } from '@/hooks/useChatSessionContext';
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
  const [question, setQuestion] = useState('');
  const { selectedModelId } = useChatSessionState();
  // Widget-local model choice seeded from the chat's composer selection —
  // picking a model here shouldn't silently retarget the main chat.
  const [modelId, setModelId] = useState(selectedModelId);
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
    if (!trimmed || askMutation.isPending) return;
    askMutation.mutate({ chatId, selection, question: trimmed, modelId });
  };

  const lineRef =
    selection.startLine === selection.endLine
      ? `${selection.startLine}`
      : `${selection.startLine}-${selection.endLine}`;
  const hasResult = askMutation.isPending || askMutation.isError || askMutation.data != null;

  return createPortal(
    <div
      className="mt-1 w-[440px] max-w-[80vw] rounded-xl border border-border bg-surface/95 shadow-medium backdrop-blur-xl dark:border-border-dark dark:bg-surface-dark/95"
      onKeyDown={(e) => {
        // Keep widget keys from falling through to Monaco's keybinding service.
        e.stopPropagation();
        // defaultPrevented = a descendant already consumed Escape (the model
        // dropdown's search closes itself) — don't also close the widget.
        if (e.key === 'Escape' && !e.defaultPrevented) handleClose();
      }}
    >
      <div className="flex h-9 items-center gap-2 border-b border-border/50 px-3 dark:border-border-dark/50">
        <span className="min-w-0 flex-1 truncate font-mono text-2xs text-text-tertiary dark:text-text-dark-tertiary">
          {selection.path}:{lineRef}
        </span>
        <ModelSelector
          selectedModelId={modelId}
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
          className="text-text-tertiary transition-colors duration-200 hover:text-text-primary dark:text-text-dark-tertiary dark:hover:text-text-dark-primary"
        >
          <X className="h-3 w-3" />
        </Button>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSubmit();
        }}
        className="flex items-center gap-1 px-2 py-1.5"
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
          className="max-h-24 flex-1 resize-none bg-transparent px-1 py-1 text-sm text-text-primary placeholder:text-text-quaternary dark:text-text-dark-primary dark:placeholder:text-text-dark-quaternary"
        />
        <Button
          type="submit"
          variant="unstyled"
          disabled={!question.trim() || askMutation.isPending}
          aria-label="Ask question"
          className="rounded-md p-1.5 text-text-tertiary transition-colors duration-200 hover:bg-surface-hover hover:text-text-primary disabled:opacity-50 dark:text-text-dark-tertiary dark:hover:bg-surface-dark-hover dark:hover:text-text-dark-primary"
        >
          <CornerDownLeft className="h-3.5 w-3.5" />
        </Button>
      </form>

      {hasResult && (
        <div className="max-h-72 overflow-y-auto rounded-b-xl border-t border-border/50 px-3 py-2 dark:border-border-dark/50">
          {askMutation.isPending && (
            <div className="flex items-center gap-2 py-0.5 text-xs text-text-tertiary dark:text-text-dark-tertiary">
              <Loader2 className="h-3 w-3 animate-spin text-text-quaternary dark:text-text-dark-quaternary" />
              Thinking…
            </div>
          )}
          {askMutation.isError && (
            <div className="text-xs text-error-600 dark:text-error-400">
              {askMutation.error.message}
            </div>
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
