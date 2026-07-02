import { ChatCopiedMessageContext } from '@/contexts/ChatCopiedMessageContextDefinition';
import { createContextHook } from '@/hooks/createContextHook';

export const useChatCopiedMessageContext = createContextHook(
  ChatCopiedMessageContext,
  'useChatCopiedMessageContext',
  'ChatCopiedMessageProvider',
);
