import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { MutationFunction, QueryClient, UseMutationOptions } from '@tanstack/react-query';

export function createMutation<TData, TError, TVariables>(
  mutationFn: MutationFunction<TData, TVariables>,
  onCacheUpdate: (
    queryClient: QueryClient,
    data: TData,
    variables: TVariables,
  ) => void | Promise<void>,
) {
  return function useMutationHook(
    options?: Omit<UseMutationOptions<TData, TError, TVariables>, 'mutationFn'>,
  ) {
    const queryClient = useQueryClient();
    const { onSuccess, ...restOptions } = options ?? {};

    return useMutation({
      mutationFn,
      onSuccess: async (data, variables, ...rest) => {
        try {
          await onCacheUpdate(queryClient, data, variables);
        } catch (e) {
          console.error('Cache update failed:', e);
        }
        if (onSuccess) {
          await onSuccess(data, variables, ...rest);
        }
      },
      ...restOptions,
    });
  };
}
