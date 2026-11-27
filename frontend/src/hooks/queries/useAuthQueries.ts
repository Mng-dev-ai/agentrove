import { useMutation, useQuery } from '@tanstack/react-query';
import type { UseMutationOptions, UseQueryOptions } from '@tanstack/react-query';
import { authService } from '@/services/authService';
import type { AuthResponse, User } from '@/types/user.types';
import { clearAllStreamState } from '@/hooks/stream/streamRegistry';
import { useChatStore } from '@/store/chatStore';
import { useNewThreadStore } from '@/store/newThreadStore';
import { useUIStore } from '@/store/uiStore';
import { PENDING_NEW_CHAT_KEY } from '@/types/ui.types';
import { createMutation } from './createMutation';
import { queryKeys } from './queryKeys';

export const useCurrentUserQuery = (options?: Partial<UseQueryOptions<User>>) => {
  return useQuery({
    queryKey: [queryKeys.auth.user],
    queryFn: () => authService.getCurrentUser(),
    retry: false,
    ...options,
  });
};

interface LoginData {
  username: string;
  password: string;
}

export const useLoginMutation = createMutation<AuthResponse, Error, LoginData>(
  (data) => authService.login(data),
  async (queryClient) => {
    await queryClient.cancelQueries();
    queryClient.clear();
  },
);

interface SignupData {
  email: string;
  username: string;
  password: string;
}

export const useSignupMutation = createMutation<User, Error, SignupData>(
  (data) => authService.signup(data),
  async (queryClient, response) => {
    const needsVerification = response.email_verification_required && !response.is_verified;
    if (!needsVerification && authService.isAuthenticated()) {
      await queryClient.cancelQueries();
      queryClient.clear();
    }
  },
);

interface VerifyEmailData {
  token: string;
}

interface ResendVerificationData {
  email: string;
}

interface ForgotPasswordData {
  email: string;
}

interface ResetPasswordData {
  token: string;
  password: string;
}

export const useVerifyEmailMutation = (
  options?: UseMutationOptions<User, Error, VerifyEmailData>,
) => {
  return useMutation({
    mutationFn: (data: VerifyEmailData) => authService.verifyEmail(data),
    ...options,
  });
};

export const useResendVerificationMutation = (
  options?: UseMutationOptions<void, Error, ResendVerificationData>,
) => {
  return useMutation({
    mutationFn: (data: ResendVerificationData) => authService.resendVerification(data),
    ...options,
  });
};

export const useForgotPasswordMutation = (
  options?: UseMutationOptions<void, Error, ForgotPasswordData>,
) => {
  return useMutation({
    mutationFn: (data: ForgotPasswordData) => authService.forgotPassword(data),
    ...options,
  });
};

export const useResetPasswordMutation = (
  options?: UseMutationOptions<void, Error, ResetPasswordData>,
) => {
  return useMutation({
    mutationFn: (data: ResetPasswordData) => authService.resetPassword(data),
    ...options,
  });
};

export const useLogoutMutation = createMutation<void, Error, void>(
  () => authService.logout(),
  async (queryClient) => {
    await queryClient.cancelQueries();
    queryClient.clear();
    // SPA logout doesn't reload — the next session must not inherit buffers, the New
    // thread draft or the last thread.
    clearAllStreamState();
    useNewThreadStore.getState().close();
    useNewThreadStore.getState().clearDraft();
    useChatStore.getState().setAttachedFilesForChat(PENDING_NEW_CHAT_KEY, []);
    useUIStore.setState({ lastThread: null });
  },
);
