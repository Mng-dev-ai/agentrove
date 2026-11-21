import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';

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
  const [inputMessage, setInputMessage] = useState(() => unsentMessage(chatId));
  const [inputFiles, setInputFiles] = useState<File[]>([]);
  const prevChatIdRef = useRef(chatId);

  if (prevChatIdRef.current !== chatId) {
    prevChatIdRef.current = chatId;
    setInputMessage(unsentMessage(chatId));
    setInputFiles([]);
  }

  useEffect(() => {
    if (!chatId) return;
    if (inputMessage) unsentMessages.set(chatId, inputMessage);
    else unsentMessages.delete(chatId);
  }, [chatId, inputMessage]);

  const clearInput = useCallback(() => {
    setInputMessage('');
    setInputFiles([]);
  }, []);

  return {
    inputMessage,
    setInputMessage,
    inputFiles,
    setInputFiles,
    clearInput,
  };
}
