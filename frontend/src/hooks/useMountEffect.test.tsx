// @vitest-environment jsdom

import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { useMountEffect } from './useMountEffect';

describe('useMountEffect', () => {
  it('runs only the first effect, even when re-rendered with a new effect identity', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ fn }) => useMountEffect(fn), {
      initialProps: { fn: first },
    });
    rerender({ fn: second });
    rerender({ fn: second });
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
  });
});
