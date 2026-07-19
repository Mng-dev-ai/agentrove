import type { ToasterProps } from 'react-hot-toast';

// Surface via the global .app-toast class (styles/app.scss) so every palette
// re-themes toasts; react-hot-toast owns the DOM, so no CSS module can reach it.
const toastSurfaceClass = 'app-toast';

export const toasterConfig: ToasterProps = {
  position: 'top-right',
  // Push toasts below the iOS status-bar/notch inset (env() is 0 on web/desktop).
  // The +1rem is just the gap below that inset — it does NOT account for the
  // TitleBar height, so on chat screens toasts still sit partly over the bar.
  containerStyle: {
    top: 'calc(env(safe-area-inset-top) + 1rem)',
  },
  toastOptions: {
    className: '',
    style: {
      padding: '12px 16px',
      fontSize: '17px',
      fontFamily: 'inherit',
      maxWidth: '420px',
    },
    duration: 4000,
    success: {
      iconTheme: {
        primary: '#22c55e',
        secondary: '#f0fdf4',
      },
      className: toastSurfaceClass,
    },
    error: {
      iconTheme: {
        primary: '#ef4444',
        secondary: '#fef2f2',
      },
      className: toastSurfaceClass,
    },
    loading: {
      iconTheme: {
        primary: '#3b82f6',
        secondary: '#eff6ff',
      },
      className: toastSurfaceClass,
    },
    blank: {
      className: toastSurfaceClass,
    },
  },
};
