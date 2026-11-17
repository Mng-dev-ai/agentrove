import { describe, it, expect, beforeEach } from 'vitest';
import { useDesktopUpdateStore } from './updateStore';

const state = () => useDesktopUpdateStore.getState();

beforeEach(() => {
  useDesktopUpdateStore.setState({ update: { status: 'idle' } });
});

describe('desktop update store', () => {
  it('mirrors each snapshot from Rust through to ready', () => {
    state().setUpdate({ status: 'available', version: '2.0.0' });
    expect(state().update).toEqual({ status: 'available', version: '2.0.0' });

    state().setUpdate({ status: 'downloading', downloadedBytes: 150, totalBytes: 300 });
    expect(state().update).toEqual({
      status: 'downloading',
      downloadedBytes: 150,
      totalBytes: 300,
    });

    state().setUpdate({ status: 'ready', version: '2.0.0' });
    expect(state().update).toEqual({ status: 'ready', version: '2.0.0' });
  });

  it('drops download progress when a snapshot moves to error', () => {
    state().setUpdate({ status: 'downloading', downloadedBytes: 400, totalBytes: 1000 });

    state().setUpdate({ status: 'error', message: 'disk full' });

    expect(state().update).toEqual({ status: 'error', message: 'disk full' });
  });
});
