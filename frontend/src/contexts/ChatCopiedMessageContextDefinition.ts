import { createContext } from 'react';
import type { MessageAttachment } from '@/types/chat.types';

interface ChatCopiedMessageContextValue {
  copiedMessageId: string | null;
  onCopy: (content: string, id: string, attachments?: MessageAttachment[]) => void;
}

export const ChatCopiedMessageContext = createContext<ChatCopiedMessageContextValue | null>(null);
