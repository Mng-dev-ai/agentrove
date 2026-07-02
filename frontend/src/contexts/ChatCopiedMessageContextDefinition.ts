import { createContext } from 'react';

interface ChatCopiedMessageContextValue {
  copiedMessageId: string | null;
}

export const ChatCopiedMessageContext = createContext<ChatCopiedMessageContextValue | null>(null);
