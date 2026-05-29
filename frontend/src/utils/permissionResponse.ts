import { usePermissionStore } from '@/store/permissionStore';
import { addResolvedPermission } from '@/utils/permissionStorage';

type ApiError = Error & { status?: number };

function isExpiredRequestError(error: unknown): boolean {
  return (error as ApiError)?.status === 404;
}

// Wraps a permission service call with standard loading/error/cleanup behavior:
// on success or 404 (expired), clears the pending state; on other errors, sets
// the provided error message.
export async function executePermissionResponse(
  serviceFn: () => Promise<void>,
  opts: {
    setIsLoading: (v: boolean) => void;
    setError: (v: string | null) => void;
    errorMessage: string;
    clearRequest: () => void;
  },
): Promise<'success' | 'expired' | 'error'> {
  opts.setIsLoading(true);
  opts.setError(null);
  try {
    await serviceFn();
    opts.clearRequest();
    return 'success';
  } catch (err) {
    if (isExpiredRequestError(err)) {
      // This request is already gone on the backend (timeout/session moved on),
      // so clear the local pending state but let the caller decide whether any
      // success-only UI transitions should still happen.
      opts.clearRequest();
      return 'expired';
    } else {
      opts.setError(err instanceof Error ? err.message : opts.errorMessage);
    }
  } finally {
    opts.setIsLoading(false);
  }
  return 'error';
}

// Called once a request has been answered (or found already-expired). Records
// the resolved seq so a replayed permission event is not re-shown after a
// refresh/reconnect, then drops the request from the in-memory queue.
export function clearPermissionRequest(chatId: string, requestId: string, seq: number): void {
  addResolvedPermission(chatId, seq);
  usePermissionStore.getState().resolvePermissionRequest(chatId, requestId);
}
