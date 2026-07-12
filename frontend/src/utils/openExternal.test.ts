// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { openUrl } = vi.hoisted(() => ({ openUrl: vi.fn() }));

vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl }));

import { openExternalUrl } from './openExternal';

beforeEach(() => {
  openUrl.mockReset();
  vi.restoreAllMocks();
});

describe('openExternalUrl', () => {
  it('opens via the Tauri opener when available', async () => {
    openUrl.mockResolvedValue(undefined);
    const win = vi.spyOn(window, 'open').mockImplementation(() => null);

    await openExternalUrl('https://example.com');

    expect(openUrl).toHaveBeenCalledWith('https://example.com');
    expect(win).not.toHaveBeenCalled();
  });

  it('falls back to window.open when the opener rejects', async () => {
    openUrl.mockRejectedValue(new Error('not tauri'));
    const win = vi.spyOn(window, 'open').mockImplementation(() => null);

    await openExternalUrl('https://example.com');

    expect(win).toHaveBeenCalledWith('https://example.com', '_blank');
  });
});
