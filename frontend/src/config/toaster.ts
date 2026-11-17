import type { ToasterProps } from 'react-hot-toast';

// Global .app-toast (app.scss) — rht owns the DOM so CSS modules can't theme it.
const toastSurfaceClass = 'app-toast';

export const toasterConfig: ToasterProps = {
  position: 'top-right',
  containerStyle: {
    top: 'calc(var(--space-10) + var(--safe-area-top) + var(--space-2))',
  },
  toastOptions: {
    className: '',
    duration: 4000,
    success: {
      iconTheme: {
        primary: 'var(--color-success-500)',
        secondary: 'var(--color-success-50)',
      },
      className: toastSurfaceClass,
    },
    error: {
      iconTheme: {
        primary: 'var(--color-error-500)',
        secondary: 'var(--color-error-50)',
      },
      className: toastSurfaceClass,
    },
    loading: {
      iconTheme: {
        primary: 'var(--color-info-500)',
        secondary: 'var(--color-info-50)',
      },
      className: toastSurfaceClass,
    },
    blank: {
      className: toastSurfaceClass,
    },
  },
};
