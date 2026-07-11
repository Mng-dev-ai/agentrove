import { useState, type RefObject } from 'react';
import { CornerDownLeft, Loader2, X } from 'lucide-react';
import { MarkDown } from '@/components/ui/markdown/MarkDown';
import { Button } from '@/components/ui/primitives/Button/Button';
import { Textarea } from '@/components/ui/primitives/Textarea/Textarea';
import { ModelSelector } from '@/components/chat/model-selector/ModelSelector';
import { useAskAboutCodeMutation } from '@/hooks/queries/useChatQueries';
import { useChatSessionState } from '@/hooks/useChatSessionContext';
import type { ComposerSelection } from '@/store/uiStore';
import styles from './InlineAskPanel.module.scss';

interface InlineAskPanelProps {
  chatId: string;
  selection: ComposerSelection;
  // Owned by the host: Monaco attaches the portal node synchronously and the
  // chat overlay mounts inline, so each decides when focusing can succeed.
  inputRef: RefObject<HTMLTextAreaElement | null>;
  onClose: () => void;
}

// One-off ask panel over a selection — hosted by the editor's Monaco content
// widget and the chat page's selection overlay.
export function InlineAskPanel({ chatId, selection, inputRef, onClose }: InlineAskPanelProps) {
  const [question, setQuestion] = useState('');
  const { selectedModelId } = useChatSessionState();
  // Panel-local override falling back to the composer selection (which may
  // resolve after mount) — picking here shouldn't retarget the main chat.
  const [modelId, setModelId] = useState('');
  const effectiveModelId = modelId || selectedModelId;
  const askMutation = useAskAboutCodeMutation();

  const handleSubmit = () => {
    const trimmed = question.trim();
    if (!trimmed || !effectiveModelId || askMutation.isPending) return;
    askMutation.mutate({ chatId, selection, question: trimmed, modelId: effectiveModelId });
  };

  const isChatText = 'kind' in selection;
  const location = isChatText
    ? 'Selection'
    : `${selection.path}:${
        selection.startLine === selection.endLine
          ? selection.startLine
          : `${selection.startLine}-${selection.endLine}`
      }`;
  const hasResult = askMutation.isPending || askMutation.isError || askMutation.data != null;

  return (
    <div
      className={styles['inline-ask']}
      onKeyDown={(e) => {
        // Keep panel keys from falling through to the host (Monaco keybindings,
        // chat-page shortcuts).
        e.stopPropagation();
        // defaultPrevented = a descendant already consumed Escape (the model
        // dropdown's search closes itself) — don't also close the panel.
        if (e.key === 'Escape' && !e.defaultPrevented) onClose();
      }}
    >
      <div className={styles['inline-ask-header']}>
        <span className={styles['inline-ask-location']}>{location}</span>
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
          onClick={onClose}
          aria-label="Close inline ask"
          className={styles['inline-ask-close']}
        >
          <X className={styles['icon-sm']} />
        </Button>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSubmit();
        }}
        className={styles['inline-ask-form']}
      >
        <Textarea
          ref={inputRef}
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
          placeholder={isChatText ? 'Ask about this selection…' : 'Ask about this code…'}
          className={styles['inline-ask-input']}
        />
        <Button
          type="submit"
          variant="unstyled"
          disabled={!question.trim() || !effectiveModelId || askMutation.isPending}
          aria-label="Ask question"
          className={styles['inline-ask-submit']}
        >
          <CornerDownLeft className={styles['inline-ask-submit-icon']} />
        </Button>
      </form>

      {hasResult && (
        <div className={styles['inline-ask-result']}>
          {askMutation.isPending && (
            <div className={styles['inline-ask-status']}>
              <Loader2 className={styles['inline-ask-spinner']} />
              Thinking…
            </div>
          )}
          {askMutation.isError && (
            <div className={styles['inline-ask-error']}>{askMutation.error.message}</div>
          )}
          {!askMutation.isPending && askMutation.data != null && (
            <MarkDown content={askMutation.data} />
          )}
        </div>
      )}
    </div>
  );
}
