// @vitest-environment jsdom

import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Input } from './Input';
import { ChatProvider } from '@/contexts/ChatContext';
import { useAuthStore } from '@/store/authStore';
import { useChatSettingsStore } from '@/store/chatSettingsStore';
import type { Model } from '@/types/chat.types';

const model: Model = {
  model_id: 'claude:sonnet',
  name: 'Sonnet',
  agent_kind: 'claude',
  context_window: 200_000,
  thinking_modes: ['low', 'high'],
};

vi.mock('@/services/modelService', () => ({
  modelService: { getModels: () => Promise.resolve([model]) },
}));
vi.mock('@/services/chatService', () => ({
  chatService: { getChat: () => new Promise(() => {}) },
}));

describe('phone composer settings sheet', () => {
  beforeEach(() => {
    vi.stubGlobal('innerWidth', 390);
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      },
    );
    useAuthStore.setState({ isAuthenticated: true });
    useChatSettingsStore.setState({ permissionModeByChat: {} });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('applies a permission mode chosen in the sheet and shows it on the Permissions row', async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ChatProvider chatId="chat-1">
          <Input
            message=""
            setMessage={vi.fn()}
            onSubmit={vi.fn()}
            isLoading={false}
            selectedModelId={model.model_id}
            onModelChange={vi.fn()}
            chatId="chat-1"
          />
        </ChatProvider>
      </QueryClientProvider>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Chat settings: Sonnet · High' }));
    const sheet = within(screen.getByRole('dialog', { name: 'Chat settings' }));
    fireEvent.click(sheet.getByRole('button', { name: /Permissions/ }));
    fireEvent.click(sheet.getByRole('option', { name: /Plan/ }));

    expect(useChatSettingsStore.getState().permissionModeByChat['chat-1']).toBe('plan');
    expect(sheet.getByRole('button', { name: /Permissions\s*Plan/ })).toBeTruthy();
  });
});
