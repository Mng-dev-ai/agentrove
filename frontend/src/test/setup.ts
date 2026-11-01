import { afterEach } from 'vitest';

// Loaded lazily and only under a DOM so node-env files don't pay for react-dom.
afterEach(async () => {
  if (typeof document === 'undefined') return;
  const { cleanup } = await import('@testing-library/react');
  cleanup();
});
