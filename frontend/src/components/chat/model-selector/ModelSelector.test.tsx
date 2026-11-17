// @vitest-environment jsdom

import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Model } from '@/types/chat.types';
import { useAuthStore } from '@/store/authStore';
import { useModelStore } from '@/store/modelStore';
import { ModelSelector } from './ModelSelector';

const models: Model[] = [
  {
    model_id: 'opencode:opencode/minimax-m3.1-flash-free',
    name: 'MiniMax M3.1 Flash',
    agent_kind: 'opencode',
    context_window: 1_000_000,
    thinking_modes: [],
  },
  {
    model_id: 'opencode:opencode/minimax-m2.7',
    name: 'MiniMax M2.7',
    agent_kind: 'opencode',
    context_window: 204_800,
    legacy: true,
    thinking_modes: [],
  },
];
const [current, legacy] = models;

vi.mock('@/services/modelService', () => ({
  modelService: { getModels: () => Promise.resolve(models) },
}));

async function openSelector(selectedModelId: string, onSubmit?: () => void) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit?.();
        }}
      >
        <ModelSelector selectedModelId={selectedModelId} onModelChange={vi.fn()} />
      </form>
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByRole('button', { expanded: false }));
  return within(screen.getByRole('listbox'));
}

beforeEach(() => {
  useAuthStore.setState({ isAuthenticated: true });
  useModelStore.setState({ modelByChat: {}, favoriteModelIds: [] });
});

describe('ModelSelector legacy models', () => {
  it('hides a legacy model that is neither selected nor favorited', async () => {
    const list = await openSelector(current.model_id);
    expect(list.getByText(current.name)).toBeTruthy();
    expect(list.queryByText(legacy.name)).toBeNull();
  });

  it('lists a legacy model while it is the selected model', async () => {
    const list = await openSelector(legacy.model_id);
    expect(list.getByText(legacy.name)).toBeTruthy();
  });

  it('lists a legacy model the user has favorited', async () => {
    useModelStore.setState({ favoriteModelIds: [legacy.model_id] });
    const list = await openSelector(current.model_id);
    expect(list.getByText(legacy.name)).toBeTruthy();
  });
});

describe('ModelSelector filter inside a form', () => {
  it('does not submit the enclosing form on Enter or when clearing the filter', async () => {
    const onSubmit = vi.fn();
    await openSelector(current.model_id, onSubmit);
    const filter = screen.getByPlaceholderText('Filter...');

    expect(fireEvent.keyDown(filter, { key: 'Enter' })).toBe(false);

    fireEvent.change(filter, { target: { value: 'minimax' } });
    expect(fireEvent.keyDown(filter, { key: 'Enter' })).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
