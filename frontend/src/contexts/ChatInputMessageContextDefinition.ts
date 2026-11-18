import { createContext, type Dispatch, type SetStateAction } from 'react';

interface ChatInputMessageContextValue {
  inputMessage: string;
  setInputMessage: (msg: string) => void;
}

export const ChatInputMessageContext = createContext<ChatInputMessageContextValue | null>(null);

// Setter-only context: its value is stable, so message bubbles that only write
// the draft don't re-render on every keystroke.
export const SetChatInputMessageContext = createContext<Dispatch<SetStateAction<string>> | null>(
  null,
);
