import { Navigate } from 'react-router-dom';
import type { ReactElement } from 'react';
import { Layout } from '@/components/layout/Layout/Layout';
import { LoadingScreen } from '@/components/ui/LoadingScreen/LoadingScreen';

interface AuthRouteProps {
  isAuthenticated: boolean;
  requireAuth: boolean;
  showLoading?: boolean;
  children: ReactElement;
}

export function AuthRoute({ isAuthenticated, requireAuth, showLoading, children }: AuthRouteProps) {
  if (requireAuth && showLoading) {
    return <LoadingScreen />;
  }

  if (requireAuth && !isAuthenticated) {
    return <Navigate to="/login" />;
  }

  if (!requireAuth && isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  return requireAuth ? <Layout>{children}</Layout> : children;
}
