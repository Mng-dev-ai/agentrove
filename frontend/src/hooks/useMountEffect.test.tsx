// @vitest-environment jsdom

import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { useMountEffect } from './useMountEffect';

describe('useMountEffect', () => {
  it('runs the effect exactly once, ignoring re-renders', () => {
    const effect = vi.fn();
    const { rerender } = renderHook(() => useMountEffect(effect));
    rerender();
    rerender();
    expect(effect).toHaveBeenCalledTimes(1);
  });

  it('runs the cleanup on unmount', () => {
    const cleanup = vi.fn();
    const { unmount } = renderHook(() => useMountEffect(() => cleanup));
    expect(cleanup).not.toHaveBeenCalled();
    unmount();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('does not re-run even when the passed effect identity changes', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ fn }) => useMountEffect(fn), {
      initialProps: { fn: first },
    });
    rerender({ fn: second });
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
  });
});
