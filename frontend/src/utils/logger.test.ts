import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { logger } from './logger';

beforeEach(() => {
  vi.spyOn(console, 'debug').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('logger message formatting', () => {
  it('includes the context segment only when provided', () => {
    logger.warn('with ctx', 'my.context');
    expect(vi.mocked(console.warn).mock.calls[0][0]).toContain('[my.context]');

    logger.warn('no ctx');
    expect(vi.mocked(console.warn).mock.calls[1][0]).not.toContain('[undefined]');
  });

  it('forwards the data payload as a trailing argument', () => {
    const data = { id: 1 };
    logger.error('boom', 'ctx', data);
    const call = vi.mocked(console.error).mock.calls[0];
    expect(call[1]).toBe(data);
  });
});

describe('logger.debug DEV gating', () => {
  it('logs when running in DEV', () => {
    vi.stubEnv('DEV', true);
    logger.debug('dev only');
    expect(console.debug).toHaveBeenCalledTimes(1);
  });

  it('is silent outside DEV', () => {
    vi.stubEnv('DEV', false);
    logger.debug('prod noise');
    expect(console.debug).not.toHaveBeenCalled();
  });
});
