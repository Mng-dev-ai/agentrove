// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { useCloudSettingsStore } from './cloudSettingsStore';

const state = () => useCloudSettingsStore.getState();

beforeEach(() => {
  localStorage.clear();
  useCloudSettingsStore.setState({ cloudUrl: '', connectedEmail: null });
});

describe('setCloud', () => {
  it('records the VPS url and connected email together', () => {
    state().setCloud('https://vps.example.com', 'user@example.com');
    expect(state().cloudUrl).toBe('https://vps.example.com');
    expect(state().connectedEmail).toBe('user@example.com');
  });
});

describe('clearCloud', () => {
  it('resets both fields to the disconnected state', () => {
    state().setCloud('https://vps.example.com', 'user@example.com');
    state().clearCloud();
    expect(state().cloudUrl).toBe('');
    expect(state().connectedEmail).toBeNull();
  });
});
