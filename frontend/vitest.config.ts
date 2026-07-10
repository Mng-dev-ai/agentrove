import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

// Merge the app's vite config so the `@/` alias resolves without a second copy.
// Scope: pure-logic unit tests only — node environment, no jsdom, no DOM/component
// tests. If we ever need component tests, add jsdom + testing-library and widen
// `include` to `*.test.tsx` then.
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'node',
      include: ['src/**/*.test.ts'],
    },
  }),
);
