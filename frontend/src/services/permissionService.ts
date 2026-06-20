import { resolveChatClient } from '@/lib/api';
import { serviceCall } from '@/services/base/BaseService';
import { validateId } from '@/utils/validation';

async function respondToPermission(
  chatId: string,
  requestId: string,
  optionId: string,
): Promise<void> {
  validateId(chatId, 'Chat ID');
  validateId(requestId, 'Request ID');

  return serviceCall(async () => {
    const formData = new FormData();
    formData.append('option_id', optionId);

    await resolveChatClient(chatId).postForm(
      `/chat/chats/${chatId}/permissions/${requestId}/respond`,
      formData,
    );
  });
}

export const permissionService = {
  respondToPermission,
};
