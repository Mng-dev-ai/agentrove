import { useCallback, type RefObject } from 'react';
import { useEnhancePromptMutation } from '@/hooks/queries/useChatQueries';

interface UseInputEnhanceOptions {
  setMessage: (value: string) => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  selectedModelId: string;
  messageRef: RefObject<string>;
  hasMessage: boolean;
}

// Prompt enhancement: fire the enhance mutation, swap the enhanced text in, and
// refocus the textarea with the caret at the end.
export function useInputEnhance({
  setMessage,
  textareaRef,
  selectedModelId,
  messageRef,
  hasMessage,
}: UseInputEnhanceOptions) {
  const focusTextarea = useCallback((text: string) => {
    const textarea = textareaRef.current;
    if (textarea) {
      setTimeout(() => {
        textarea.focus();
        const length = text.length;
        textarea.setSelectionRange(length, length);
      }, 0);
    }
  }, []);

  const enhancePromptMutation = useEnhancePromptMutation({
    onSuccess: (enhancedPrompt) => {
      setMessage(enhancedPrompt);
      focusTextarea(enhancedPrompt);
    },
  });

  const isEnhancing = enhancePromptMutation.isPending;

  const handleEnhancePrompt = useCallback(() => {
    if (!hasMessage || isEnhancing) return;
    enhancePromptMutation.mutate({ prompt: messageRef.current.trim(), modelId: selectedModelId });
  }, [hasMessage, isEnhancing, selectedModelId, enhancePromptMutation]);

  return {
    isEnhancing,
    handleEnhancePrompt,
  };
}
