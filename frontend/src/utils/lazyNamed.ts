import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

const CHUNK_RELOAD_KEY = 'chunk-reload-at';
const CHUNK_RELOAD_INTERVAL = 30_000;

export function reloadStaleChunk(): boolean {
  const now = Date.now();

  try {
    const reloadAt = Number(window.sessionStorage.getItem(CHUNK_RELOAD_KEY));

    if (reloadAt && now - reloadAt < CHUNK_RELOAD_INTERVAL) {
      return false;
    }

    window.sessionStorage.setItem(CHUNK_RELOAD_KEY, String(now));
  } catch {
    return false;
  }

  window.location.reload();
  return true;
}

// React.lazy for named exports. ComponentType<any> keeps T as the concrete
// component type (stricter props bounds break contravariant inference).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyNamed<T extends ComponentType<any>>(
  factory: () => Promise<Record<string, T>>,
  name: string,
): LazyExoticComponent<T> {
  return lazy(() =>
    factory().then(
      (m) => ({ default: m[name] }),
      (error: unknown) => {
        if (reloadStaleChunk()) {
          return new Promise<never>(() => {});
        }

        throw error;
      },
    ),
  );
}
