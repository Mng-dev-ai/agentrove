// @vitest-environment jsdom

import { createContext } from 'react';
import type { ReactNode } from 'react';
import { renderHook } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { createContextHook } from './createContextHook';

interface Value {
  label: string;
}

describe('createContextHook', () => {
  it('returns the context value when rendered inside a provider', () => {
    const Ctx = createContext<Value | null>(null);
    const useValue = createContextHook(Ctx, 'useValue', 'ValueProvider');
    const value: Value = { label: 'hi' };

    const wrapper = ({ children }: { children: ReactNode }) => (
      <Ctx.Provider value={value}>{children}</Ctx.Provider>
    );

    const { result } = renderHook(() => useValue(), { wrapper });
    expect(result.current).toBe(value);
  });

  it('throws a named error when used outside a provider', () => {
    const Ctx = createContext<Value | null>(null);
    const useValue = createContextHook(Ctx, 'useValue', 'ValueProvider');
    // The hook throws during render; renderHook re-raises it to the caller.
    expect(() => renderHook(() => useValue())).toThrow(
      'useValue must be used within a ValueProvider',
    );
  });
});
