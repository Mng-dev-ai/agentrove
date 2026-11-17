// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { ServiceError } from '@/services/base/ServiceError';
import { machineChatService } from './machineChatService';

const patch = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api', () => ({
  getMachineClient: () => ({ patch }),
}));

describe('updateSettings', () => {
  it('surfaces a server error on the first attempt instead of retrying with backoff', async () => {
    patch.mockRejectedValue(new ServiceError('Server exploded', 'API_ERROR', undefined, 500));

    await expect(
      machineChatService.updateSettings('machine-1', { notifications_enabled: false }),
    ).rejects.toThrow('Server exploded');
    expect(patch).toHaveBeenCalledTimes(1);
  });
});
