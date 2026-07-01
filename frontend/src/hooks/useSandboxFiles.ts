import { useMemo } from 'react';
import { useFilesMetadataQuery } from '@/hooks/queries/useSandboxQueries';
import { buildFileStructureFromSandboxFiles } from '@/utils/file';
import type { Chat as ChatSummary } from '@/types/chat.types';
import type { FileStructure } from '@/types/file-system.types';

interface UseSandboxFilesResult {
  fileStructure: FileStructure[];
  filesMetadata: Parameters<typeof buildFileStructureFromSandboxFiles>[0];
  isFileMetadataLoading: boolean;
  refetchFilesMetadata: () => Promise<unknown>;
}

export function useSandboxFiles(
  currentChat: ChatSummary | undefined,
  chatId: string | undefined,
): UseSandboxFilesResult {
  const sandboxId = currentChat?.sandbox_id;

  const {
    data: filesMetadata = [],
    isLoading,
    refetch,
  } = useFilesMetadataQuery(sandboxId, currentChat?.worktree_cwd ?? undefined, {
    enabled: !!sandboxId && !!chatId,
  });

  const fileStructure = useMemo(() => {
    if (filesMetadata.length > 0) {
      return buildFileStructureFromSandboxFiles(filesMetadata, []);
    }
    return [];
  }, [filesMetadata]);

  return {
    fileStructure,
    filesMetadata,
    isFileMetadataLoading: isLoading,
    refetchFilesMetadata: refetch,
  };
}
