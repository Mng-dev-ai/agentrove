// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { useToggleSet } from './useToggleSet';

describe('useToggleSet', () => {
  it('seeds the set from the initial iterable', () => {
    const { result } = renderHook(() => useToggleSet<string>(['a', 'b']));
    const [set] = result.current;
    expect([...set].sort()).toEqual(['a', 'b']);
  });

  it('starts empty when no initial value is given', () => {
    const { result } = renderHook(() => useToggleSet<string>());
    expect(result.current[0].size).toBe(0);
  });

  it('toggle adds an absent item and removes a present one', () => {
    const { result } = renderHook(() => useToggleSet<string>());

    act(() => result.current[1]('x'));
    expect(result.current[0].has('x')).toBe(true);

    act(() => result.current[1]('x'));
    expect(result.current[0].has('x')).toBe(false);
  });

  it('returns a new Set instance on toggle (no in-place mutation)', () => {
    const { result } = renderHook(() => useToggleSet<string>(['a']));
    const before = result.current[0];

    act(() => result.current[1]('b'));
    expect(result.current[0]).not.toBe(before);
    // The previous snapshot is left untouched.
    expect(before.has('b')).toBe(false);
  });

  it('keeps a stable toggle identity across renders', () => {
    const { result, rerender } = renderHook(() => useToggleSet<string>());
    const toggle = result.current[1];
    act(() => result.current[1]('a'));
    rerender();
    expect(result.current[1]).toBe(toggle);
  });

  it('exposes the raw setter for direct replacement', () => {
    const { result } = renderHook(() => useToggleSet<number>([1]));
    act(() => result.current[2](new Set([9, 10])));
    expect([...result.current[0]]).toEqual([9, 10]);
  });
});
