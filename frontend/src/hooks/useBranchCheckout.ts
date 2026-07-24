import { useCallback } from 'react';
import toast from 'react-hot-toast';
import { useCheckoutBranchMutation } from '@/hooks/queries/useSandboxQueries';

// Shared checkout behavior for the branch selectors: the same-branch guard, the
// mutation, and its four toast strings. Callers pass the branch to check out and
// the current branch to guard against a no-op.
export function useBranchCheckout(sandboxId: string | undefined, cwd?: string) {
  const checkoutBranch = useCheckoutBranchMutation();

  const checkout = useCallback(
    (branch: string, currentBranch: string) => {
      if (branch === currentBranch || !sandboxId) return;
      checkoutBranch.mutate(
        { sandboxId, branch, cwd },
        {
          onSuccess: (data) => {
            if (data.success) {
              toast.success(`Switched to ${branch}`);
            } else {
              toast.error(data.error ?? 'Failed to switch branch');
            }
          },
          onError: (err) => {
            toast.error(err instanceof Error ? err.message : 'Failed to switch branch');
          },
        },
      );
    },
    [checkoutBranch, sandboxId, cwd],
  );

  return { checkout, isPending: checkoutBranch.isPending };
}
