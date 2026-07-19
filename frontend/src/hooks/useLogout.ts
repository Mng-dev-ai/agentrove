import { useNavigate } from 'react-router-dom';
import { useLogoutMutation } from '@/hooks/queries/useAuthQueries';
import { useAuthStore } from '@/store/authStore';

export function useLogout() {
  const navigate = useNavigate();
  return useLogoutMutation({
    onSuccess: () => {
      useAuthStore.getState().setAuthenticated(false);
      navigate('/login');
    },
  });
}
