import type { ToasterProps } from 'react-hot-toast';

const baseStyle = {
  boxShadow: '0 4px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
};

// Colors via token classes (not inline style) so every palette re-themes them;
// `!` overrides react-hot-toast's default inline background/color
const toastSurfaceClass =
  '!border !bg-surface-secondary !text-text-primary !border-border ' +
  'dark:!bg-surface-dark-secondary dark:!text-text-dark-primary dark:!border-border-dark';

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
      fontSize: '14px',
      fontFamily: 'inherit',
      maxWidth: '420px',
    },
    duration: 4000,
    success: {
      style: baseStyle,
      iconTheme: {
        primary: '#22c55e',
        secondary: '#f0fdf4',
      },
      className: toastSurfaceClass,
    },
    error: {
      style: baseStyle,
      iconTheme: {
        primary: '#ef4444',
        secondary: '#fef2f2',
      },
      className: toastSurfaceClass,
    },
    loading: {
      style: baseStyle,
      iconTheme: {
        primary: '#3b82f6',
        secondary: '#eff6ff',
      },
      className: toastSurfaceClass,
    },
    blank: {
      style: baseStyle,
      className: toastSurfaceClass,
    },
  },
};
