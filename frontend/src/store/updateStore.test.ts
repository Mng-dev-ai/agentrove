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

describe('desktop update lifecycle', () => {
  it('walks available -> downloading -> chunks -> installing', () => {
    const trigger = vi.fn(async () => {});
    state().setAvailable(availableInfo, trigger);
    expect(state()).toMatchObject({
      status: 'available',
      version: '2.0.0',
      releaseNotes: 'notes',
      triggerInstall: trigger,
    });

    state().setDownloading();
    state().setDownloadStarted(300);
    state().addDownloadChunk(100);
    state().addDownloadChunk(200);
    state().setInstalling();

    expect(state()).toMatchObject({ status: 'installing', downloadedBytes: 300, totalBytes: 300 });
  });

  it('clears progress and the error when a retry starts downloading after a failure', () => {
    state().setDownloading();
    state().setDownloadStarted(1000);
    state().addDownloadChunk(400);
    state().setError('disk full');
    expect(state()).toMatchObject({ status: 'error', errorMessage: 'disk full' });

    state().setDownloading();

    expect(state()).toMatchObject({
      status: 'downloading',
      downloadedBytes: 0,
      totalBytes: null,
      errorMessage: null,
    });
  });

  it('clears prior progress and error when a new update is announced', () => {
    state().setDownloadStarted(1000);
    state().addDownloadChunk(500);
    state().setError('old failure');

    state().setAvailable(
      availableInfo,
      vi.fn(async () => {}),
    );

    expect(state()).toMatchObject({
      status: 'available',
      downloadedBytes: 0,
      totalBytes: null,
      errorMessage: null,
    });
  });
});
