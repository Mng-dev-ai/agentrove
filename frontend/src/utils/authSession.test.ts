// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { clearAuth } = vi.hoisted(() => ({ clearAuth: vi.fn() }));

vi.mock('@/utils/storage', () => ({ authStorage: { clearAuth } }));

// Fresh module per test so the module-level `redirectInProgress` latch resets.
async function load() {
  vi.resetModules();
  return import('./authSession');
}

function stubLocation(pathname: string) {
  const replace = vi.fn();
  Object.defineProperty(window, 'location', {
    value: { pathname, replace },
    writable: true,
    configurable: true,
  });
  return replace;
}

beforeEach(() => {
  clearAuth.mockClear();
});

describe('invalidateSessionAndRedirect', () => {
  it('clears auth and redirects to /login from a normal route', async () => {
    const replace = stubLocation('/dashboard');
    const { invalidateSessionAndRedirect } = await load();

    invalidateSessionAndRedirect();

    expect(clearAuth).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith('/login');
  });

  it('clears auth but does not redirect when already on /login', async () => {
    const replace = stubLocation('/login');
    const { invalidateSessionAndRedirect } = await load();

    invalidateSessionAndRedirect();

    expect(clearAuth).toHaveBeenCalledTimes(1);
    expect(replace).not.toHaveBeenCalled();
  });

  it('redirects only once even when called repeatedly', async () => {
    const replace = stubLocation('/dashboard');
    const { invalidateSessionAndRedirect } = await load();

    invalidateSessionAndRedirect();
    invalidateSessionAndRedirect();
    invalidateSessionAndRedirect();

    // The redirectInProgress latch guards against a redirect storm.
    expect(replace).toHaveBeenCalledTimes(1);
    // clearAuth still runs on every call.
    expect(clearAuth).toHaveBeenCalledTimes(3);
  });
});
