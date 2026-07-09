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
  Secret,
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
    // The editor unmounts on every chat switch; outlive the default 2-minute gc
    // so returning to a chat reopens its files from cache instead of refetching.
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
    // The listing is the slow sandbox call in the editor's reopen path; keep it
    // cached across chat switches (ChatPage refetches it when the editor re-activates).
    gcTime: 1000 * 60 * 30,
    ...options,
  });
};

export const useSecretsQuery = (
  sandboxId: string | undefined,
  options?: Partial<UseQueryOptions<Secret[]>>,
) => {
  return useQuery({
    queryKey: queryKeys.sandbox.secrets(sandboxId),
    queryFn: () => sandboxService.getSecrets(sandboxId!),
    enabled: !!sandboxId,
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

type SecretMutationVariables = { sandboxId: string; key: string; value?: string };

function createSecretMutation<TVariables extends { sandboxId: string }>(
  mutationFn: (variables: TVariables) => Promise<void>,
) {
  return createMutation<void, Error, TVariables>(mutationFn, (queryClient, _data, variables) => {
    queryClient.invalidateQueries({ queryKey: queryKeys.sandbox.secrets(variables.sandboxId) });
  });
}

export const useAddSecretMutation = createSecretMutation<SecretMutationVariables>(
  ({ sandboxId, key, value }) => sandboxService.addSecret(sandboxId, key, value!),
);

export const useUpdateSecretMutation = createSecretMutation<SecretMutationVariables>(
  ({ sandboxId, key, value }) => sandboxService.updateSecret(sandboxId, key, value!),
);

export const useDeleteSecretMutation = createSecretMutation<{ sandboxId: string; key: string }>(
  ({ sandboxId, key }) => sandboxService.deleteSecret(sandboxId, key),
);

// Every query derived from git state (diff content, per-file HEAD baselines,
// change indicators) — git actions must refresh them together; one forgotten
// key leaves the diff view or indicators stale.
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
    // Branches can change out-of-band (terminal `git checkout`, external tools), so refetch on
    // window focus with a short stale window to pick those up without aggressive polling.
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
        // Checkout rewrites file contents wholesale; reset (not remove — remove
        // doesn't refetch active observers) so an open editor file reloads from
        // the new branch instead of keeping the old branch's buffer.
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

// Repo-relative paths with uncommitted changes — powers change indicators
// without fetching diff content.
export const useGitChangedPathsQuery = (sandboxId: string | undefined, cwd?: string) => {
  return useQuery({
    queryKey: queryKeys.sandbox.gitChangedPaths(sandboxId, cwd),
    queryFn: () => sandboxService.getGitChangedPaths(sandboxId!, cwd),
    enabled: !!sandboxId,
    // The working tree changes out-of-band (terminal commands, external tools),
    // so refetch on window focus with a short stale window like branches do.
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
};

// The committed (HEAD) version of a single file — the diff baseline the editor
// compares the working buffer against.
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
    // HEAD only moves on explicit git actions (which invalidate this key); the
    // short stale window still picks up out-of-band terminal commits on re-toggle.
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
    // Require at least 2 chars so we don't fire a giant match set on first keystroke.
    enabled: !!sandboxId && params.query.trim().length >= 2,
    placeholderData: keepPreviousData,
    staleTime: 15_000,
    ...options,
  });
};

// Diff paths are cwd-relative while the editor caches workspace-root-relative
// paths (e.g. `.worktrees/<id>/src/App.tsx`), so targeting a specific
// `fileContent` key would miss worktree entries. Invalidate the whole
// file-content space under this sandbox instead. Restore doesn't move HEAD,
// so gitFileBaselineAll is deliberately not refreshed here.
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
