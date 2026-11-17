import type { UseQueryResult } from '@tanstack/react-query';
import { ServiceError } from '@/services/base/ServiceError';

export interface ListLoadState {
  loadFailed: boolean;
  isRetrying: boolean;
  retry: () => Promise<unknown>;
}

// serviceCall already backs off on 500/503/504, so list loads retry once more only for
// failures it skipped that can be transient (network, 502) and never for 4xx.
export function retryTransientOnce(failureCount: number, error: Error): boolean {
  if (failureCount > 0) return false;
  if (!(error instanceof ServiceError) || error.status === undefined) return true;
  return error.status >= 500 && !ServiceError.isRetryable(error);
}

// A refetch puts a never-loaded query back to pending; errorUpdateCount survives it, so
// the failure stays visible (and can show a pending retry) until data actually arrives.
// Disabled sources (signed out, machine offline) can't load or retry, so they never fail.
function hasFailedFirstLoad(result: UseQueryResult<unknown>): boolean {
  return result.isEnabled && result.data === undefined && result.errorUpdateCount > 0;
}

export function listLoadState(results: UseQueryResult<unknown>[]): ListLoadState {
  const failed = results.filter(hasFailedFirstLoad);
  return {
    loadFailed: failed.length > 0,
    isRetrying: failed.some((result) => result.isFetching),
    retry: () => Promise.all(failed.map((result) => result.refetch())),
  };
}
