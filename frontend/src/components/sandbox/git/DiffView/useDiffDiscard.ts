import { useCallback, useState } from 'react';
import toast from 'react-hot-toast';
import type { FileDiffMetadata } from '@pierre/diffs';
import {
  useGitRestoreAllMutation,
  useGitRestoreFileMutation,
} from '@/hooks/queries/useSandboxQueries';
import { isRenameFileType } from '@/utils/fileTypes';

interface UseDiffDiscardParams {
  sandboxId: string | undefined;
  cwd: string | undefined;
}

export function useDiffDiscard({ sandboxId, cwd }: UseDiffDiscardParams) {
  const [discardTarget, setDiscardTarget] = useState<FileDiffMetadata | null>(null);
  const [discardAllOpen, setDiscardAllOpen] = useState(false);

  const restoreFile = useGitRestoreFileMutation();
  const restoreAll = useGitRestoreAllMutation();

  const handleDiscard = useCallback(async () => {
    if (!sandboxId || !discardTarget) return;
    const file = discardTarget;
    try {
      const result = await restoreFile.mutateAsync({
        sandboxId,
        filePath: file.name,
        oldPath: isRenameFileType(file.type) ? file.prevName : undefined,
        cwd,
      });
      if (result.success) {
        toast.success('Changes discarded');
      } else {
        toast.error(result.error || 'Failed to discard changes');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to discard changes');
    }
  }, [sandboxId, discardTarget, cwd, restoreFile]);

  const handleDiscardAll = useCallback(async () => {
    if (!sandboxId) return;
    try {
      const result = await restoreAll.mutateAsync({ sandboxId, cwd });
      if (result.success) {
        toast.success('All changes discarded');
      } else {
        toast.error(result.error || 'Failed to discard all changes');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to discard all changes');
    }
  }, [sandboxId, cwd, restoreAll]);

  return {
    discardTarget,
    setDiscardTarget,
    discardAllOpen,
    setDiscardAllOpen,
    handleDiscard,
    handleDiscardAll,
    restoreFilePending: restoreFile.isPending,
    restoreAllPending: restoreAll.isPending,
  };
}
