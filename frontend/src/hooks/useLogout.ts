import { useNavigate } from 'react-router-dom';
import { useLogoutMutation } from '@/hooks/queries/useAuthQueries';
import { useAuthStore } from '@/store/authStore';

// Shared logout flow: tears down the session, drops the auth flag, and routes to /login.
export function useLogout() {
  const navigate = useNavigate();
  return useLogoutMutation({
    onSuccess: () => {
      useAuthStore.getState().setAuthenticated(false);
      navigate('/login');
    },
  });
}
