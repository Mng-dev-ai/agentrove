// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { settingsService } from './settingsService';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('updateSettings', () => {
  it('surfaces a server error on the first attempt instead of retrying with backoff', async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({ detail: 'Server exploded' }), { status: 500 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(settingsService.updateSettings({ notifications_enabled: false })).rejects.toThrow(
      'Server exploded',
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
