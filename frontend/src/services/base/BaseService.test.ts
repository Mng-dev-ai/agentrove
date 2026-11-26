import { describe, expect, it, vi } from 'vitest';

import { NetworkError, ServiceError } from './ServiceError';
import { serviceCall } from './BaseService';

describe('serviceCall', () => {
  it('passes NetworkError through unchanged', async () => {
    const error = new NetworkError();
    const request = () => Promise.reject(error);

    await expect(serviceCall(request)).rejects.toBe(error);
  });

  it.each([500, 502, 503, 504])('does not retry a %i response', async (status) => {
    const request = vi.fn(() =>
      Promise.reject(new ServiceError('Docker unavailable', undefined, {}, status)),
    );

    await expect(serviceCall(request)).rejects.toMatchObject({ status });
    expect(request).toHaveBeenCalledOnce();
  });
});
