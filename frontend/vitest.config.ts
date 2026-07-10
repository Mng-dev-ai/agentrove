import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

// Merge the app's vite config so the `@/` alias resolves without a second copy.
// Pure-logic tests stay in node; component tests opt into jsdom with Vitest's
// per-file environment directive.
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'node',
      include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    },
  }),
);
