export class ServiceError extends Error {
  constructor(
    message: string,
    public code?: string,
    public details?: unknown,
    public status?: number,
  ) {
    super(message);
    this.name = 'ServiceError';
  }

  static fromResponse(error: unknown): ServiceError {
    if (error instanceof ServiceError) {
      return error;
    }

    if (error instanceof Error) {
      return new ServiceError(error.message, 'UNKNOWN_ERROR', error);
    }

    return new ServiceError('An unknown error occurred', 'UNKNOWN_ERROR', error);
  }

  static isRetryable(error: ServiceError): boolean {
    if (!error.status) return false;

    return error.status === 500 || error.status === 503 || error.status === 504;
  }
}

export class AuthenticationError extends ServiceError {
  constructor(message = 'Authentication failed') {
    super(message, 'AUTH_ERROR', undefined, 401);
    this.name = 'AuthenticationError';
  }
}

export class ValidationError extends ServiceError {
  constructor(message: string, details?: unknown) {
    super(message, 'VALIDATION_ERROR', details, 400);
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends ServiceError {
  constructor(message: string) {
    super(message, 'NOT_FOUND', undefined, 404);
    this.name = 'NotFoundError';
  }
}

export class NetworkError extends ServiceError {
  constructor(message = 'Network request failed') {
    super(message, 'NETWORK_ERROR');
    this.name = 'NetworkError';
  }
}
