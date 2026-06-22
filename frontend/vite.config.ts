import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { generatePaletteCss, generateDiffPaletteCss } from './src/styles/generatePaletteCss';

// CSS generated from the hex palette source (src/styles/palettes.ts) at build time, so
// the RGB-channel vars aren't a second hand-maintained copy. Consumers import the virtual
// ids as a side-effect: main.tsx (surface tokens, global), DiffView (pierre diff tokens).
const VIRTUAL_CSS: Record<string, () => string> = {
  'virtual:palette-overrides.css': generatePaletteCss,
  'virtual:diff-palette-overrides.css': generateDiffPaletteCss,
};

function paletteCssPlugin(): Plugin {
  return {
    name: 'agentrove:palette-css',
    resolveId: (id) => (id in VIRTUAL_CSS ? `\0${id}` : null),
    load: (id) => (id.startsWith('\0') ? (VIRTUAL_CSS[id.slice(1)]?.() ?? null) : null),
  };
}

export default defineConfig({
  plugins: [react(), paletteCssPlugin()],
  worker: {
    // @pierre/diffs ships an imported worker entry, so desktop builds need
    // module workers instead of Vite's default IIFE output.
    format: 'es',
  },
  optimizeDeps: {
    include: ['mermaid', '@tanstack/react-query'],
    esbuildOptions: {
      target: 'esnext',
    },
  },
  build: {
    target: 'esnext',
    commonjsOptions: {
      include: [/mermaid/, /antd/, /@tanstack/, /node_modules/],
      transformMixedEsModules: true,
    },
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'query-vendor': ['@tanstack/react-query', '@tanstack/react-query-devtools'],
          monaco: ['monaco-editor', '@monaco-editor/react'],
          terminal: ['xterm', 'xterm-addon-fit'],
          mermaid: ['mermaid'],
          markdown: ['react-markdown', 'remark-gfm', 'remark-math', 'rehype-katex'],
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: true,
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://api:8080',
        changeOrigin: true,
        ws: true,
        secure: false,
      },
      '/admin': {
        target: 'http://api:8080',
        changeOrigin: false,
        secure: false,
        autoRewrite: true,
      },
    },
  },
});
