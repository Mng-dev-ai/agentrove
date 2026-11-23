import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ServiceError, ValidationError } from '@/services/base/ServiceError';
import { LOCAL_MACHINE_ID } from '@/types/machine.types';
import { modelService } from './modelService';
import { settingsService } from './settingsService';

const { get, patch, invalidateSessionAndRedirect } = vi.hoisted(() => ({
  get: vi.fn(),
  patch: vi.fn(),
  invalidateSessionAndRedirect: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  getMachineClient: () => ({ get, patch }),
}));
vi.mock('@/utils/authSession', () => ({ invalidateSessionAndRedirect }));

const ORIGINS = [LOCAL_MACHINE_ID, 'machine-1'];

beforeEach(() => {
  vi.clearAllMocks();
});

describe.each(ORIGINS)('updateSettings on %s', (machineId) => {
  it('rejects an empty update without sending a request', async () => {
    await expect(settingsService.updateSettings(machineId, {})).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(patch).not.toHaveBeenCalled();
  });

  it('surfaces a server error on the first attempt instead of retrying with backoff', async () => {
    patch.mockRejectedValue(new ServiceError('Server exploded', 'API_ERROR', undefined, 500));

    await expect(
      settingsService.updateSettings(machineId, { notifications_enabled: false }),
    ).rejects.toThrow('Server exploded');
    expect(patch).toHaveBeenCalledTimes(1);
  });
});

describe.each([
  ['getSettings', settingsService.getSettings],
  ['getModels', modelService.getModels],
])('%s on a 401', (_name, request) => {
  beforeEach(() => {
    get.mockRejectedValue(Object.assign(new Error('Unauthorized'), { status: 401 }));
  });

  it('ends the local session when the local backend rejects the token', async () => {
    await expect(request(LOCAL_MACHINE_ID)).rejects.toMatchObject({ status: 401 });
    expect(invalidateSessionAndRedirect).toHaveBeenCalledTimes(1);
  });

  it('leaves the local session alone when a paired machine rejects the token', async () => {
    await expect(request('machine-1')).rejects.toMatchObject({ status: 401 });
    expect(invalidateSessionAndRedirect).not.toHaveBeenCalled();
  });
});
