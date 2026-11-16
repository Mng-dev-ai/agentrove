import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { githubService } from '@/services/githubService';
import { queryKeys } from '@/hooks/queries/queryKeys';
import { useGitRemoteUrlQuery } from '@/hooks/queries/useSandboxQueries';
import type {
  CreatePRRequest,
  CreatePRResponse,
  GenerateCommitMessageRequest,
  GenerateCommitMessageResponse,
  GeneratePRDescriptionRequest,
  GeneratePRDescriptionResponse,
  PullRequestFilters,
} from '@/types/github.types';

export function useGitHubReposQuery(query: string, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.github.repos(query),
    queryFn: () => githubService.searchRepositories(query, 1, 20),
    enabled,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}

// chatId routes each call to the backend that owns the chat (local or cloud VPS)
// so its GitHub credentials are used — see githubService.
export function useGitHubPullsQuery(
  owner: string,
  repo: string,
  enabled: boolean,
  chatId?: string,
  filters?: PullRequestFilters,
) {
  return useQuery({
    queryKey: queryKeys.github.pulls(owner, repo, chatId, filters),
    queryFn: () => githubService.listPullRequests(owner, repo, chatId, filters),
    enabled: enabled && !!owner && !!repo,
    staleTime: 30_000,
  });
}

export function useGitHubCollaboratorsQuery(
  owner: string,
  repo: string,
  enabled: boolean,
  chatId?: string,
) {
  return useQuery({
    queryKey: queryKeys.github.collaborators(owner, repo, chatId),
    queryFn: () => githubService.getCollaborators(owner, repo, chatId),
    enabled: enabled && !!owner && !!repo,
    staleTime: 300_000,
  });
}

export function useBranchPullRequests(
  sandboxId: string,
  worktreeCwd: string | undefined,
  branch: string,
  chatId?: string,
) {
  const { data: remoteUrl } = useGitRemoteUrlQuery(sandboxId, !!sandboxId, worktreeCwd);
  const owner = remoteUrl?.owner ?? '';
  const repo = remoteUrl?.repo ?? '';
  const { data: pulls, error: pullsError } = useGitHubPullsQuery(
    owner,
    repo,
    !!owner && !!repo && !!branch,
    chatId,
    {
      head: `${owner}:${branch}`,
      state: 'all',
    },
  );
  const { openPR, mergedPR } = useMemo(() => {
    const branchPulls =
      branch && owner && repo
        ? pulls?.items.filter(
            (pr) => pr.head.ref === branch && pr.head.repo.full_name === `${owner}/${repo}`,
          )
        : undefined;
    return {
      openPR: branchPulls?.find((pr) => pr.state === 'open'),
      mergedPR: branchPulls?.find((pr) => pr.merged),
    };
  }, [pulls?.items, branch, owner, repo]);
  return { owner, repo, openPR, mergedPR, pullsError };
}

export function useCreatePullRequestMutation(chatId?: string) {
  const queryClient = useQueryClient();
  return useMutation<CreatePRResponse, Error, CreatePRRequest>({
    mutationFn: (request) => githubService.createPullRequest(request, chatId),
    onSuccess: (_data, { owner, repo }) =>
      queryClient.invalidateQueries({ queryKey: queryKeys.github.pullsAll(owner, repo, chatId) }),
  });
}

export function useGeneratePRDescriptionMutation(chatId?: string) {
  return useMutation<GeneratePRDescriptionResponse, Error, GeneratePRDescriptionRequest>({
    mutationFn: (request) => githubService.generatePRDescription(request, chatId),
  });
}

export function useGenerateCommitMessageMutation(chatId?: string) {
  return useMutation<GenerateCommitMessageResponse, Error, GenerateCommitMessageRequest>({
    mutationFn: (request) => githubService.generateCommitMessage(request, chatId),
  });
}
