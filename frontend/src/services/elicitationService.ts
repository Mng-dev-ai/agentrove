import { resolveChatClient } from '@/lib/api';
import { serviceCall } from '@/services/base/BaseService';
import { validateId } from '@/utils/validation';
import type { ElicitationAction, ElicitationContent } from '@/types/chat.types';

async function respondToElicitation(
  chatId: string,
  requestId: string,
  action: ElicitationAction,
  content: ElicitationContent | null,
): Promise<void> {
  validateId(chatId, 'Chat ID');
  validateId(requestId, 'Request ID');

  return serviceCall(async () => {
    await resolveChatClient(chatId).post(`/chat/chats/${chatId}/elicitation/${requestId}/respond`, {
      request_id: requestId,
      action,
      content,
    });
  });
}

export const elicitationService = {
  respondToElicitation,
};
