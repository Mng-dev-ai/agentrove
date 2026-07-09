import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import App from './App.tsx';
import './styles/app.scss';
// Build-time-generated `data-palette` override blocks (see vite.config.ts).
import 'virtual:palette-overrides.css';
import { queryClient, persistOptions } from './lib/queryClient';
import { isMobileApp } from './utils/platform';

// iOS WebKit zooms into any focused input with font-size < 16px. The app's dense
// type scale (text-xs/sm) would trigger it on every input tap, so lock the scale
// in the native shell. Web keeps the default viewport so pinch-zoom still works.
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
