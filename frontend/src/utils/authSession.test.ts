// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Fresh modules per test so the redirect latch and the token cache both reset.
async function load() {
  vi.resetModules();
  const [{ invalidateSessionAndRedirect }, { authStorage }] = await Promise.all([
    import('./authSession'),
    import('./storage'),
  ]);
  return { invalidateSessionAndRedirect, authStorage };
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
  localStorage.clear();
  localStorage.setItem('auth_token', 'access');
  localStorage.setItem('refresh_token', 'refresh');
});

describe('invalidateSessionAndRedirect', () => {
  it('clears stored tokens and redirects to /login from a normal route', async () => {
    const replace = stubLocation('/dashboard');
    const { invalidateSessionAndRedirect, authStorage } = await load();

    invalidateSessionAndRedirect();

    expect(authStorage.getToken()).toBeNull();
    expect(authStorage.getRefreshToken()).toBeNull();
    expect(localStorage.getItem('auth_token')).toBeNull();
    expect(localStorage.getItem('refresh_token')).toBeNull();
    expect(replace).toHaveBeenCalledWith('/login');
  });

  it('clears tokens but does not redirect when already on /login', async () => {
    const replace = stubLocation('/login');
    const { invalidateSessionAndRedirect } = await load();

    invalidateSessionAndRedirect();

    expect(localStorage.getItem('auth_token')).toBeNull();
    expect(replace).not.toHaveBeenCalled();
  });

  it('redirects only once even when called repeatedly', async () => {
    const replace = stubLocation('/dashboard');
    const { invalidateSessionAndRedirect } = await load();

    invalidateSessionAndRedirect();
    invalidateSessionAndRedirect();
    invalidateSessionAndRedirect();

    expect(replace).toHaveBeenCalledTimes(1);
  });
});
