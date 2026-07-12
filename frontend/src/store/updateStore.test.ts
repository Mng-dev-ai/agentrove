import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useDesktopUpdateStore } from './updateStore';

const state = () => useDesktopUpdateStore.getState();

const availableInfo = {
  version: '2.0.0',
  currentVersion: '1.0.0',
  body: 'notes',
  date: '2020-01-01',
};

beforeEach(() => {
  useDesktopUpdateStore.setState({
    status: 'idle',
    version: null,
    currentVersion: null,
    releaseNotes: null,
    releaseDate: null,
    downloadedBytes: 0,
    totalBytes: null,
    errorMessage: null,
    triggerInstall: null,
  });
});

describe('setAvailable', () => {
  it('populates release info and stores the install trigger', () => {
    const trigger = vi.fn(async () => {});
    state().setAvailable(availableInfo, trigger);

    expect(state().status).toBe('available');
    expect(state().version).toBe('2.0.0');
    expect(state().currentVersion).toBe('1.0.0');
    expect(state().releaseNotes).toBe('notes');
    expect(state().releaseDate).toBe('2020-01-01');
    expect(state().triggerInstall).toBe(trigger);
  });

  it('clears any prior progress and error when a new update appears', () => {
    useDesktopUpdateStore.setState({
      downloadedBytes: 500,
      totalBytes: 1000,
      errorMessage: 'old failure',
    });
    state().setAvailable(
      availableInfo,
      vi.fn(async () => {}),
    );

    expect(state().downloadedBytes).toBe(0);
    expect(state().totalBytes).toBeNull();
    expect(state().errorMessage).toBeNull();
  });
});

describe('download progress', () => {
  it('resets counters when downloading starts', () => {
    useDesktopUpdateStore.setState({ downloadedBytes: 42, totalBytes: 100, errorMessage: 'x' });
    state().setDownloading();

    expect(state().status).toBe('downloading');
    expect(state().downloadedBytes).toBe(0);
    expect(state().totalBytes).toBeNull();
    expect(state().errorMessage).toBeNull();
  });

  it('records the total size once the response headers arrive', () => {
    state().setDownloadStarted(2048);
    expect(state().totalBytes).toBe(2048);
  });

  it('leaves totalBytes null when Content-Length is absent', () => {
    state().setDownloadStarted(null);
    expect(state().totalBytes).toBeNull();
  });

  it('accumulates chunk lengths across calls', () => {
    state().addDownloadChunk(100);
    state().addDownloadChunk(250);
    expect(state().downloadedBytes).toBe(350);
  });
});

describe('terminal transitions', () => {
  it('moves to installing without disturbing download counters', () => {
    state().setDownloadStarted(1000);
    state().addDownloadChunk(1000);
    state().setInstalling();
    expect(state().status).toBe('installing');
    expect(state().downloadedBytes).toBe(1000);
  });

  it('records an error status and message', () => {
    state().setError('disk full');
    expect(state().status).toBe('error');
    expect(state().errorMessage).toBe('disk full');
  });
});

describe('full update lifecycle', () => {
  it('walks available -> downloading -> started -> chunks -> installing', () => {
    state().setAvailable(
      availableInfo,
      vi.fn(async () => {}),
    );
    state().setDownloading();
    state().setDownloadStarted(300);
    state().addDownloadChunk(100);
    state().addDownloadChunk(200);
    state().setInstalling();

    expect(state().status).toBe('installing');
    expect(state().downloadedBytes).toBe(300);
    expect(state().totalBytes).toBe(300);
  });
});
