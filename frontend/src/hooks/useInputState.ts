import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from 'react';

interface UseInputStateParams {
  chatId: string | undefined;
}

interface UseInputStateResult {
  inputMessage: string;
  setInputMessage: Dispatch<SetStateAction<string>>;
  inputFiles: File[];
  setInputFiles: Dispatch<SetStateAction<File[]>>;
  clearInput: () => void;
}

const unsentMessages = new Map<string, string>();

function unsentMessage(chatId: string | undefined): string {
  return (chatId && unsentMessages.get(chatId)) || '';
}

export function useInputState({ chatId }: UseInputStateParams): UseInputStateResult {
  const [inputMessage, setInputMessageState] = useState(() => unsentMessage(chatId));
  const [inputFiles, setInputFiles] = useState<File[]>([]);
  const inputMessageRef = useRef(inputMessage);
  const prevChatIdRef = useRef(chatId);

  if (prevChatIdRef.current !== chatId) {
    prevChatIdRef.current = chatId;
    inputMessageRef.current = unsentMessage(chatId);
    setInputMessageState(inputMessageRef.current);
    setInputFiles([]);
  }

  const setInputMessage = useCallback(
    (value: SetStateAction<string>) => {
      const next = typeof value === 'function' ? value(inputMessageRef.current) : value;
      inputMessageRef.current = next;
      if (chatId) {
        if (next) unsentMessages.set(chatId, next);
        else unsentMessages.delete(chatId);
      }
      setInputMessageState(next);
    },
    [chatId],
  );

  const clearInput = useCallback(() => {
    setInputMessage('');
    setInputFiles([]);
  }, [setInputMessage]);

  return {
    inputMessage,
    setInputMessage,
    inputFiles,
    setInputFiles,
    clearInput,
  };
}
