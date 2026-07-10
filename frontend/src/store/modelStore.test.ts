// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { useModelStore } from './modelStore';

beforeEach(() => {
  localStorage.clear();
  useModelStore.setState({ modelByChat: {}, favoriteModelIds: [] });
});

describe('selectModel', () => {
  it('records the model for a chat', () => {
    useModelStore.getState().selectModel('c1', 'gpt-5');
    expect(useModelStore.getState().modelByChat.c1).toBe('gpt-5');
  });

  it('trims surrounding whitespace before storing', () => {
    useModelStore.getState().selectModel('c1', '  gpt-5  ');
    expect(useModelStore.getState().modelByChat.c1).toBe('gpt-5');
  });

  it('ignores empty or whitespace-only ids', () => {
    useModelStore.getState().selectModel('c1', '   ');
    expect('c1' in useModelStore.getState().modelByChat).toBe(false);
  });

  it('returns the same state when the id is unchanged', () => {
    useModelStore.getState().selectModel('c1', 'gpt-5');
    const before = useModelStore.getState().modelByChat;
    useModelStore.getState().selectModel('c1', 'gpt-5');
    expect(useModelStore.getState().modelByChat).toBe(before);
  });

  it('keeps per-chat selections independent', () => {
    useModelStore.getState().selectModel('c1', 'gpt-5');
    useModelStore.getState().selectModel('c2', 'claude');
    expect(useModelStore.getState().modelByChat).toEqual({ c1: 'gpt-5', c2: 'claude' });
  });
});

describe('toggleFavoriteModel', () => {
  it('adds a model to favorites on first toggle', () => {
    useModelStore.getState().toggleFavoriteModel('m1');
    expect(useModelStore.getState().favoriteModelIds).toEqual(['m1']);
  });

  it('removes a model on the second toggle', () => {
    useModelStore.getState().toggleFavoriteModel('m1');
    useModelStore.getState().toggleFavoriteModel('m1');
    expect(useModelStore.getState().favoriteModelIds).toEqual([]);
  });

  it('preserves insertion order and only removes the toggled id', () => {
    const toggle = useModelStore.getState().toggleFavoriteModel;
    toggle('m1');
    toggle('m2');
    toggle('m3');
    toggle('m2');
    expect(useModelStore.getState().favoriteModelIds).toEqual(['m1', 'm3']);
  });
});
