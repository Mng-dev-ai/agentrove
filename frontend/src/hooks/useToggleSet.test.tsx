// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { useToggleSet } from './useToggleSet';

describe('useToggleSet', () => {
  it('seeds the set from the initial iterable', () => {
    const { result } = renderHook(() => useToggleSet<string>(['a', 'b']));
    expect([...result.current[0]].sort()).toEqual(['a', 'b']);
  });

  it('toggle adds an absent item and removes a present one', () => {
    const { result } = renderHook(() => useToggleSet<string>());

    act(() => result.current[1]('x'));
    expect(result.current[0].has('x')).toBe(true);

    act(() => result.current[1]('x'));
    expect(result.current[0].has('x')).toBe(false);
  });

  it('returns a new Set on toggle and leaves the previous snapshot untouched', () => {
    const { result } = renderHook(() => useToggleSet<string>(['a']));
    const before = result.current[0];

    act(() => result.current[1]('b'));
    expect(result.current[0]).not.toBe(before);
    expect(before.has('b')).toBe(false);
  });

  it('keeps a stable toggle identity across renders', () => {
    const { result, rerender } = renderHook(() => useToggleSet<string>());
    const toggle = result.current[1];
    act(() => result.current[1]('a'));
    rerender();
    expect(result.current[1]).toBe(toggle);
  });
});
