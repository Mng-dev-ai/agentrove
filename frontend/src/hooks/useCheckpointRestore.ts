import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { chatService } from '@/services/chatService';
import { invalidateAfterGitRestore } from '@/hooks/queries/useSandboxQueries';
import { queryKeys } from '@/hooks/queries/queryKeys';

export function useCheckpointRestore(
  chatId: string | undefined,
  messageId: string,
  sandboxId?: string,
) {
  const queryClient = useQueryClient();

  const restoreMutation = useMutation({
    mutationFn: () => chatService.restoreMessageCheckpoint(chatId, messageId),
    onSuccess: async (result) => {
      if (!result.success) {
        toast.error(result.error || 'Failed to restore checkpoint');
        return;
      }
      toast.success('Workspace restored to before this run');
      await queryClient.invalidateQueries({
        queryKey: queryKeys.messageChanges(chatId, messageId),
      });
      if (sandboxId) {
        await invalidateAfterGitRestore(queryClient, sandboxId);
      }
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to restore checkpoint');
    },
  });

  return {
    restore: restoreMutation.mutate,
    isRestoring: restoreMutation.isPending,
  };
}
