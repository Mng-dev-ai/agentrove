// @vitest-environment jsdom

import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useAsyncEffect } from './useAsyncEffect';

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// Resolve microtasks so the effect's async body runs to completion.
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('useAsyncEffect', () => {
  it('runs the effect on mount with a cancelled() probe that reads false', async () => {
    const seen: boolean[] = [];
    renderHook(() =>
      useAsyncEffect(async (cancelled) => {
        seen.push(cancelled());
      }, []),
    );
    await flush();
    expect(seen).toEqual([false]);
  });

  it('re-runs only when deps change', async () => {
    const effect = vi.fn(async () => {});
    const { rerender } = renderHook(({ dep }) => useAsyncEffect(effect, [dep]), {
      initialProps: { dep: 1 },
    });
    await flush();
    expect(effect).toHaveBeenCalledTimes(1);

    rerender({ dep: 1 });
    await flush();
    expect(effect).toHaveBeenCalledTimes(1);

    rerender({ dep: 2 });
    await flush();
    expect(effect).toHaveBeenCalledTimes(2);
  });

  it('flips cancelled() to true after unmount so post-await work can bail', async () => {
    let probe: (() => boolean) | null = null;
    let resolveGate: () => void = () => {};
    const gate = new Promise<void>((r) => {
      resolveGate = r;
    });

    const { unmount } = renderHook(() =>
      useAsyncEffect(async (cancelled) => {
        probe = cancelled;
        await gate;
      }, []),
    );

    expect(probe!()).toBe(false);
    unmount();
    resolveGate();
    await flush();
    expect(probe!()).toBe(true);
  });

  it('logs rejections only when the effect is still active', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderHook(() =>
      useAsyncEffect(async () => {
        throw new Error('boom');
      }, []),
    );
    await flush();
    expect(errorSpy).toHaveBeenCalledWith('useAsyncEffect error:', expect.any(Error));
  });

  it('swallows a rejection that surfaces after unmount', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    let reject: (e: unknown) => void = () => {};
    const gate = new Promise<void>((_, rej) => {
      reject = rej;
    });

    const { unmount } = renderHook(() => useAsyncEffect(async () => gate, []));
    unmount();
    reject(new Error('late'));
    await flush();
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
