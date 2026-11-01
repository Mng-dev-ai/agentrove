import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { openUrl } = vi.hoisted(() => ({ openUrl: vi.fn() }));

vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl }));

import { openExternalUrl } from './openExternal';

const windowOpen = vi.fn();

beforeEach(() => {
  openUrl.mockReset();
  windowOpen.mockReset();
  vi.stubGlobal('window', { open: windowOpen });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('openExternalUrl', () => {
  it('opens via the Tauri opener when available', async () => {
    openUrl.mockResolvedValue(undefined);

    await openExternalUrl('https://example.com');

    expect(openUrl).toHaveBeenCalledWith('https://example.com');
    expect(windowOpen).not.toHaveBeenCalled();
  });

  it('falls back to a new browser tab when the opener rejects', async () => {
    openUrl.mockRejectedValue(new Error('not tauri'));

    await openExternalUrl('https://example.com');

    expect(windowOpen).toHaveBeenCalledWith('https://example.com', '_blank');
  });
});
