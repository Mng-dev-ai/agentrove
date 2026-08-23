import { describe, expect, it, vi } from 'vitest';

import { NetworkError, ServiceError } from './ServiceError';
import { serviceCall } from './BaseService';

describe('serviceCall', () => {
  it('passes NetworkError through unchanged', async () => {
    const error = new NetworkError();
    const request = () => Promise.reject(error);

    await expect(serviceCall(request, { maxRetries: 0 })).rejects.toBe(error);
  });

  it('does not retry a 502 response', async () => {
    const request = vi.fn(() =>
      Promise.reject(new ServiceError('Docker unavailable', undefined, {}, 502)),
    );

    await expect(serviceCall(request)).rejects.toMatchObject({ status: 502 });
    expect(request).toHaveBeenCalledOnce();
  });
});
