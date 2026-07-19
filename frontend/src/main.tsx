import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
// Global tokens/resets before component CSS so modules win cascade ties.
import './styles/app.scss';
import App from './App.tsx';
// Build-time palette CSS overrides (vite.config.ts).
import 'virtual:palette-overrides.css';
import { queryClient, persistOptions } from './lib/queryClient';
import { isMobileApp } from './utils/platform';

// iOS WebKit zooms inputs with font-size < 16px; lock scale in the native shell only.
if (isMobileApp()) {
  document
    .querySelector('meta[name="viewport"]')
    ?.setAttribute(
      'content',
      'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover',
    );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}>
      <App />
    </PersistQueryClientProvider>
  </StrictMode>,
);
