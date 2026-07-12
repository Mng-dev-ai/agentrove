import { apiClient } from '@/lib/api';
import { ensureResponse, serviceCall, withAuth } from '@/services/base/BaseService';
import { ValidationError } from '@/services/base/ServiceError';
import type { AuthResponse, User } from '@/types/user.types';
import { authStorage } from '@/utils/storage';
import {
  validateRequired,
  isValidEmail,
  isValidUsername,
  isValidPassword,
} from '@/utils/validation';

interface LoginRequest {
  username: string;
  password: string;
}

interface SignupRequest {
  email: string;
  username: string;
  password: string;
}

interface VerifyEmailRequest {
  token: string;
}

interface ResendVerificationRequest {
  email: string;
}

interface ForgotPasswordRequest {
  email: string;
}

interface ResetPasswordRequest {
  token: string;
  password: string;
}

async function signup(data: SignupRequest): Promise<User> {
  validateRequired(data.email, 'Email');
  validateRequired(data.username, 'Username');
  validateRequired(data.password, 'Password');

  if (!isValidEmail(data.email)) {
    throw new ValidationError('Invalid email address');
  }

  if (!isValidUsername(data.username)) {
    throw new ValidationError(
      'Username must be 3-30 characters, contain only letters, numbers, and underscores, and cannot start or end with underscore',
    );
  }

  if (!isValidPassword(data.password, 8)) {
    throw new ValidationError('Password must be at least 8 characters');
  }

  return serviceCall(async () => {
    const response = await apiClient.post<User>('/auth/register', data);
    const user = ensureResponse(response, 'Invalid response from server');

    const needsVerification = user.email_verification_required && !user.is_verified;
    if (needsVerification) {
      return user;
    }

    const formData = new FormData();
    formData.append('username', data.email);
    formData.append('password', data.password);

    const loginResponse = await apiClient.postForm<AuthResponse>('/auth/jwt/login', formData);
    const auth = ensureResponse(loginResponse, 'Invalid response from server');
    await authStorage.setTokens(auth.access_token, auth.refresh_token);

    return user;
  });
}

async function login(data: LoginRequest): Promise<AuthResponse> {
  validateRequired(data.username, 'Username');
  validateRequired(data.password, 'Password');

  return serviceCall(async () => {
    const formData = new FormData();
    formData.append('username', data.username);
    formData.append('password', data.password);

    const response = await apiClient.postForm<AuthResponse>('/auth/jwt/login', formData);
    const payload = ensureResponse(response, 'Invalid response from server');

    await authStorage.setTokens(payload.access_token, payload.refresh_token);
    return payload;
  });
}

async function getCurrentUser(): Promise<User> {
  return withAuth(async () => {
    const response = await apiClient.get<User>('/auth/me');
    return ensureResponse(response, 'Invalid response from server');
  });
}

async function logout(): Promise<void> {
  const currentRefreshToken = authStorage.getRefreshToken();
  try {
    if (currentRefreshToken) {
      await apiClient.post('/auth/jwt/logout', { refresh_token: currentRefreshToken });
    }
  } finally {
    authStorage.clearAuth();
  }
}

const getToken = authStorage.getToken;
const isAuthenticated = (): boolean => !!authStorage.getToken();

async function verifyEmail(data: VerifyEmailRequest): Promise<User> {
  validateRequired(data.token, 'Token');

  return serviceCall(async () => {
    const response = await apiClient.post<User>('/auth/verify', { token: data.token });
    return ensureResponse(response, 'Invalid response from server');
  });
}

async function resendVerification(data: ResendVerificationRequest): Promise<void> {
  validateRequired(data.email, 'Email');

  return serviceCall(async () => {
    await apiClient.post('/auth/request-verify-token', data);
  });
}

async function forgotPassword(data: ForgotPasswordRequest): Promise<void> {
  validateRequired(data.email, 'Email');

  return serviceCall(async () => {
    await apiClient.post('/auth/forgot-password', data);
  });
}

async function resetPassword(data: ResetPasswordRequest): Promise<void> {
  validateRequired(data.token, 'Token');
  validateRequired(data.password, 'Password');

  return serviceCall(async () => {
    await apiClient.post('/auth/reset-password', data);
  });
}

export const authService = {
  signup,
  login,
  getCurrentUser,
  logout,
  getToken,
  isAuthenticated,
  verifyEmail,
  resendVerification,
  forgotPassword,
  resetPassword,
};
