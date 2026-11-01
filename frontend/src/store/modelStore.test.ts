// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { useModelStore } from './modelStore';

beforeEach(() => {
  localStorage.clear();
  useModelStore.setState({ modelByChat: {}, favoriteModelIds: [] });
});

describe('selectModel', () => {
  it('trims surrounding whitespace before storing', () => {
    useModelStore.getState().selectModel('c1', '  gpt-5  ');
    expect(useModelStore.getState().modelByChat.c1).toBe('gpt-5');
  });

  it('ignores whitespace-only ids instead of clearing the selection', () => {
    useModelStore.getState().selectModel('c1', 'gpt-5');
    useModelStore.getState().selectModel('c1', '   ');
    expect(useModelStore.getState().modelByChat.c1).toBe('gpt-5');
  });

  it('keeps the map reference when the id is unchanged', () => {
    useModelStore.getState().selectModel('c1', 'gpt-5');
    const before = useModelStore.getState().modelByChat;
    useModelStore.getState().selectModel('c1', ' gpt-5 ');
    expect(useModelStore.getState().modelByChat).toBe(before);
  });
});

describe('toggleFavoriteModel', () => {
  it('adds on first toggle, removes on second, and preserves the order of the rest', () => {
    const toggle = useModelStore.getState().toggleFavoriteModel;
    toggle('m1');
    toggle('m2');
    toggle('m3');
    toggle('m2');
    expect(useModelStore.getState().favoriteModelIds).toEqual(['m1', 'm3']);
  });
});
