import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import type { QueryClient, UseQueryOptions } from '@tanstack/react-query';
import { sandboxService } from '@/services/sandboxService';
import type {
  DiffMode,
  FileContent,
  FileMetadata,
  GitCommitResult,
  GitCreateBranchResult,
  GitDiffData,
  GitFileBaselineData,
  GitPushPullResult,
  SearchParams,
  SearchResponse,
  UpdateFileResult,
} from '@/types/sandbox.types';
import { createMutation } from './createMutation';
import { queryKeys } from './queryKeys';

export const useFileContentQuery = (
  sandboxId: string | undefined,
  filePath: string | undefined,
  options?: Partial<UseQueryOptions<FileContent>>,
) => {
  return useQuery({
    queryKey: queryKeys.sandbox.fileContent(sandboxId, filePath),
    queryFn: () => sandboxService.getFileContent(sandboxId!, filePath!),
    enabled: !!sandboxId && !!filePath,
    // Editor unmounts on chat switch; outlive default 2m gc so reopen hits cache.
    gcTime: 1000 * 60 * 30,
    ...options,
  });
};

export const useFilesMetadataQuery = (
  sandboxId: string | undefined,
  cwd?: string,
  options?: Partial<UseQueryOptions<FileMetadata[]>>,
) => {
  return useQuery({
    queryKey: queryKeys.sandbox.filesMetadata(sandboxId, cwd),
    queryFn: () => sandboxService.getSandboxFilesMetadata(sandboxId!, cwd),
    enabled: !!sandboxId,
    // Slow listing on reopen — keep across chat switches.
    gcTime: 1000 * 60 * 30,
    ...options,
  });
};

interface UpdateFileParams {
  sandboxId: string;
  filePath: string;
  content: string;
}

export const useUpdateFileMutation = createMutation<UpdateFileResult, Error, UpdateFileParams>(
  ({ sandboxId, filePath, content }) => sandboxService.updateFile(sandboxId, filePath, content),
  async (queryClient, _data, { sandboxId, filePath }) => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: queryKeys.sandbox.fileContent(sandboxId, filePath),
      }),
      queryClient.invalidateQueries({
        queryKey: queryKeys.sandbox.filesMetadataAll(sandboxId),
      }),
      invalidateGitState(queryClient, sandboxId),
    ]);
  },
);

// All git-derived caches — refresh together or diff/indicators go stale.
export const invalidateGitState = (queryClient: QueryClient, sandboxId: string) =>
  Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.sandbox.gitDiffAll(sandboxId) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.sandbox.gitFileBaselineAll(sandboxId) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.sandbox.gitChangedPathsAll(sandboxId) }),
  ]);

export const useGitBranchesQuery = (
  sandboxId: string | undefined,
  enabled: boolean,
  cwd?: string,
) => {
  return useQuery({
    queryKey: queryKeys.sandbox.gitBranches(sandboxId, cwd),
    queryFn: () => sandboxService.getGitBranches(sandboxId!, cwd),
    enabled: !!sandboxId && enabled,
    // Out-of-band branch changes (terminal/external) — focus refetch, short stale.
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
};

export const useCheckoutBranchMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ sandboxId, branch, cwd }: { sandboxId: string; branch: string; cwd?: string }) =>
      sandboxService.checkoutGitBranch(sandboxId, branch, cwd),
    onSuccess: async (data, variables) => {
      if (!data.success) return;
      await Promise.all([
        // reset (not remove) so open editors refetch the new branch's content.
        queryClient.resetQueries({
          queryKey: queryKeys.sandbox.fileContentAll(variables.sandboxId),
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.sandbox.gitBranchesAll(variables.sandboxId),
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.sandbox.filesMetadataAll(variables.sandboxId),
        }),
        invalidateGitState(queryClient, variables.sandboxId),
      ]);
    },
  });
};

export const useGitDiffQuery = (
  sandboxId: string | undefined,
  mode: DiffMode = 'all',
  fullContext: boolean = false,
  cwd?: string,
  options?: Partial<UseQueryOptions<GitDiffData>>,
) => {
  return useQuery({
    queryKey: queryKeys.sandbox.gitDiff(sandboxId, mode, fullContext, cwd),
    queryFn: () => sandboxService.getGitDiff(sandboxId!, mode, fullContext, cwd),
    enabled: !!sandboxId,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
    ...options,
  });
};

// Uncommitted paths for change indicators (no full diff).
export const useGitChangedPathsQuery = (sandboxId: string | undefined, cwd?: string) => {
  return useQuery({
    queryKey: queryKeys.sandbox.gitChangedPaths(sandboxId, cwd),
    queryFn: () => sandboxService.getGitChangedPaths(sandboxId!, cwd),
    enabled: !!sandboxId,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
};

// HEAD content of a file — editor diff baseline.
export const useGitFileBaselineQuery = (
  sandboxId: string | undefined,
  path: string | undefined,
  cwd?: string,
  options?: Partial<UseQueryOptions<GitFileBaselineData>>,
) => {
  return useQuery({
    queryKey: queryKeys.sandbox.gitFileBaseline(sandboxId, path, cwd),
    queryFn: () => sandboxService.getGitFileBaseline(sandboxId!, path!, cwd),
    enabled: !!sandboxId && !!path,
    // Invalidated on git actions; short stale still picks up terminal commits on re-toggle.
    staleTime: 30_000,
    ...options,
  });
};

export const useGitRemoteUrlQuery = (sandboxId: string, enabled: boolean, cwd?: string) => {
  return useQuery({
    queryKey: queryKeys.sandbox.gitRemoteUrl(sandboxId, cwd),
    queryFn: () => sandboxService.getGitRemoteUrl(sandboxId, cwd),
    enabled: !!sandboxId && enabled,
    staleTime: 300_000,
  });
};

export const useGitCommitMutation = createMutation<
  GitCommitResult,
  Error,
  { sandboxId: string; message: string; cwd?: string }
>(
  ({ sandboxId, message, cwd }) => sandboxService.gitCommit(sandboxId, message, cwd),
  async (queryClient, _data, variables) => {
    await invalidateGitState(queryClient, variables.sandboxId);
  },
);

export const useGitPushMutation = createMutation<
  GitPushPullResult,
  Error,
  { sandboxId: string; cwd?: string }
>(
  ({ sandboxId, cwd }) => sandboxService.gitPush(sandboxId, cwd),
  async (queryClient, _data, variables) => {
    await queryClient.invalidateQueries({
      queryKey: queryKeys.sandbox.gitBranchesAll(variables.sandboxId),
    });
  },
);

export const useGitPullMutation = createMutation<
  GitPushPullResult,
  Error,
  { sandboxId: string; cwd?: string }
>(
  ({ sandboxId, cwd }) => sandboxService.gitPull(sandboxId, cwd),
  async (queryClient, _data, variables) => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: queryKeys.sandbox.gitBranchesAll(variables.sandboxId),
      }),
      queryClient.invalidateQueries({
        queryKey: queryKeys.sandbox.filesMetadataAll(variables.sandboxId),
      }),
      invalidateGitState(queryClient, variables.sandboxId),
    ]);
  },
);

export const useSearchInFilesQuery = (
  sandboxId: string | undefined,
  params: SearchParams,
  options?: Partial<UseQueryOptions<SearchResponse>>,
) => {
  return useQuery({
    queryKey: queryKeys.sandbox.search(
      sandboxId,
      params.query,
      params.cwd,
      params.caseSensitive,
      params.regex,
      params.wholeWord,
      params.include,
      params.exclude,
    ),
    queryFn: () => sandboxService.searchInFiles(sandboxId!, params),
    enabled: !!sandboxId && params.query.trim().length >= 2,
    placeholderData: keepPreviousData,
    staleTime: 15_000,
    ...options,
  });
};

// Diff paths are cwd-relative; editor caches are workspace-root-relative — invalidate all
// fileContent under this sandbox. Restore doesn't move HEAD, so skip gitFileBaselineAll.
export const invalidateAfterGitRestore = (queryClient: QueryClient, sandboxId: string) =>
  Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.sandbox.gitDiffAll(sandboxId) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.sandbox.filesMetadataAll(sandboxId) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.sandbox.fileContentAll(sandboxId) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.sandbox.gitChangedPathsAll(sandboxId) }),
  ]);

export const useGitRestoreFileMutation = createMutation<
  GitCommitResult,
  Error,
  { sandboxId: string; filePath: string; oldPath?: string; cwd?: string }
>(
  ({ sandboxId, filePath, oldPath, cwd }) =>
    sandboxService.gitRestoreFile(sandboxId, filePath, oldPath, cwd),
  async (queryClient, _data, variables) => {
    await invalidateAfterGitRestore(queryClient, variables.sandboxId);
  },
);

export const useGitRestoreAllMutation = createMutation<
  GitCommitResult,
  Error,
  { sandboxId: string; cwd?: string }
>(
  ({ sandboxId, cwd }) => sandboxService.gitRestoreAll(sandboxId, cwd),
  async (queryClient, _data, variables) => {
    await invalidateAfterGitRestore(queryClient, variables.sandboxId);
  },
);

export const useGitCreateBranchMutation = createMutation<
  GitCreateBranchResult,
  Error,
  { sandboxId: string; name: string; baseBranch?: string; cwd?: string }
>(
  ({ sandboxId, name, baseBranch, cwd }) =>
    sandboxService.gitCreateBranch(sandboxId, name, baseBranch, cwd),
  async (queryClient, _data, variables) => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: queryKeys.sandbox.gitBranchesAll(variables.sandboxId),
      }),
      queryClient.invalidateQueries({
        queryKey: queryKeys.sandbox.filesMetadataAll(variables.sandboxId),
      }),
      invalidateGitState(queryClient, variables.sandboxId),
    ]);
  },
);
