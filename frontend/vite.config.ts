import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
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
          terminal: ['xterm', 'xterm-addon-fit', 'xterm-addon-web-links'],
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
