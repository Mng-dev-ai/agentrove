import { usePermissionStore } from '@/store/permissionStore';
import { addResolvedPermission } from '@/utils/permissionStorage';

type ApiError = Error & { status?: number };

function isExpiredRequestError(error: unknown): boolean {
  return (error as ApiError)?.status === 404;
}

// Loading/error wrapper: success or 404 clears pending; other errors set message.
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
      // Expired on backend — clear local pending; caller decides success-only UI.
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

// Record resolved seq (blocks SSE replay after refresh) and drop from the queue.
export function clearPermissionRequest(chatId: string, requestId: string, seq: number): void {
  addResolvedPermission(chatId, seq);
  usePermissionStore.getState().resolvePermissionRequest(chatId, requestId);
}
