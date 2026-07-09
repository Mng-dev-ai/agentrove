import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

// Wraps React.lazy for modules whose component is a named (not default) export.
// The bound is ComponentType<any> so T is inferred as the component's concrete
// type — a stricter prop-shaped bound makes TS fall back to the constraint and
// reject the module's real prop type (contravariant inference).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyNamed<T extends ComponentType<any>>(
  factory: () => Promise<Record<string, T>>,
  name: string,
): LazyExoticComponent<T> {
  return lazy(() => factory().then((m) => ({ default: m[name] })));
}
