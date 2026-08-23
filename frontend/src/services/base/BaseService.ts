import { ServiceError, AuthenticationError } from './ServiceError';
import { invalidateSessionAndRedirect } from '@/utils/authSession';

const ERROR_MESSAGES: Record<string, string> = {
  LOGIN_BAD_CREDENTIALS: 'Invalid email or password',
  LOGIN_USER_NOT_VERIFIED: 'Please verify your email before logging in',
  REGISTER_USER_ALREADY_EXISTS: 'An account with this email already exists',
  REGISTER_INVALID_PASSWORD: 'Password does not meet requirements',
  RESET_PASSWORD_BAD_TOKEN: 'Invalid or expired reset token',
  RESET_PASSWORD_INVALID_PASSWORD: 'Password does not meet requirements',
  VERIFY_USER_BAD_TOKEN: 'Invalid or expired verification token',
  VERIFY_USER_ALREADY_VERIFIED: 'Your email is already verified',
  VERIFY_USER_TOKEN_EXPIRED: 'Verification link has expired',
};

function formatErrorMessage(error: string | undefined): string {
  if (!error) {
    return 'An unexpected error occurred';
  }

  const upperError = error.toUpperCase();

  for (const [code, message] of Object.entries(ERROR_MESSAGES)) {
    if (upperError.includes(code)) {
      return message;
    }
  }

  return error;
}

interface ServiceCallOptions {
  maxRetries?: number;
  retryDelay?: number;
  signal?: AbortSignal;
}

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_DELAY = 1000;

export async function serviceCall<T>(
  fn: () => Promise<T>,
  options: ServiceCallOptions = {},
): Promise<T> {
  const { maxRetries = DEFAULT_MAX_RETRIES, retryDelay = DEFAULT_RETRY_DELAY, signal } = options;
  let lastError: ServiceError | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (signal?.aborted) {
        throw new ServiceError('Request aborted', 'ABORTED');
      }

      return await fn();
    } catch (error) {
      lastError = handleServiceError(error);

      if (lastError instanceof AuthenticationError) {
        throw lastError;
      }

      const shouldRetry = ServiceError.isRetryable(lastError) && attempt < maxRetries;
      if (!shouldRetry) {
        throw lastError;
      }

      await delay(retryDelay * Math.pow(2, attempt));
    }
  }

  throw lastError || new ServiceError('Max retries exceeded');
}

export async function withAuth<T>(
  fn: () => Promise<T>,
  options: ServiceCallOptions = {},
): Promise<T> {
  try {
    return await serviceCall(fn, options);
  } catch (error) {
    if (error instanceof AuthenticationError) {
      handleAuthError();
    }
    throw error;
  }
}

export function ensureResponse<T>(
  value: T | null | undefined,
  message = 'Invalid response from server',
): T {
  if (value === null || value === undefined) {
    throw new ServiceError(message, 'EMPTY_RESPONSE');
  }
  return value;
}

function handleServiceError(error: unknown): ServiceError {
  if (error instanceof ServiceError) {
    error.message = formatErrorMessage(error.message);
    return error;
  }

  if (error instanceof Error) {
    const status = (error as Error & { status?: number }).status;

    if (status === 401 || error.message.includes('401') || error.message.includes('Unauthorized')) {
      return new AuthenticationError();
    }

    const statusMatch = error.message.match(/status:\s*(\d+)/);
    const derivedStatus = statusMatch ? parseInt(statusMatch[1], 10) : undefined;
    const formattedMessage = formatErrorMessage(error.message);

    return new ServiceError(formattedMessage, 'API_ERROR', error, status ?? derivedStatus);
  }

  return ServiceError.fromResponse(error);
}

export function buildQueryString(
  params?: Record<string, string | number | boolean | undefined | null>,
): string {
  if (!params) return '';

  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      searchParams.append(key, String(value));
    }
  });

  const queryString = searchParams.toString();
  return queryString ? `?${queryString}` : '';
}

function handleAuthError(): void {
  invalidateSessionAndRedirect();
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
