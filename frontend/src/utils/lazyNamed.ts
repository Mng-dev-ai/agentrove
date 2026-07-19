import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

// React.lazy for named exports. ComponentType<any> keeps T as the concrete
// component type (stricter props bounds break contravariant inference).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyNamed<T extends ComponentType<any>>(
  factory: () => Promise<Record<string, T>>,
  name: string,
): LazyExoticComponent<T> {
  return lazy(() => factory().then((m) => ({ default: m[name] })));
}
