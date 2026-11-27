// @vitest-environment jsdom

import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { queryKeys } from '@/hooks/queries/queryKeys';
import { LOCAL_MACHINE_ID } from '@/types/machine.types';
import type { Model } from '@/types/chat.types';
import { useChatAgentKind } from './useChatAgentKind';

const CATALOG: Model[] = [
  {
    model_id: 'gpt-7-test',
    name: 'GPT-7 Test',
    agent_kind: 'codex',
    context_window: null,
    thinking_modes: [],
  },
];

describe('useChatAgentKind', () => {
  it('resolves a model id the static conventions miss from the loaded catalog', () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
    queryClient.setQueryData(queryKeys.machine.models(LOCAL_MACHINE_ID), CATALOG);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useChatAgentKind('chat-1', null, 'gpt-7-test'), {
      wrapper,
    });
    expect(result.current).toBe('codex');
  });
});
