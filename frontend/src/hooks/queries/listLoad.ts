import type { UseQueryResult } from '@tanstack/react-query';
import { ServiceError } from '@/services/base/ServiceError';

// serviceCall already backs off on 500/503/504, so list loads retry once more only for
// failures it skipped that can be transient (network, 502) and never for 4xx.
export function retryTransientOnce(failureCount: number, error: Error): boolean {
  if (failureCount > 0) return false;
  if (!(error instanceof ServiceError) || error.status === undefined) return true;
  return error.status >= 500 && !ServiceError.isRetryable(error);
}

// A refetch puts a never-loaded query back to pending; errorUpdateCount survives it, so
// the failure stays visible (and can show a pending retry) until data actually arrives.
export function hasFailedFirstLoad(result: UseQueryResult<unknown>): boolean {
  return result.data === undefined && result.errorUpdateCount > 0;
}

export function refetchFailed(results: UseQueryResult[]): Promise<unknown> {
  return Promise.all(results.filter((result) => result.isError).map((result) => result.refetch()));
}
