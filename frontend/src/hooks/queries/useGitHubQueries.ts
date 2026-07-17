import { useMutation, useQuery, keepPreviousData } from '@tanstack/react-query';
import { githubService } from '@/services/githubService';
import { queryKeys } from '@/hooks/queries/queryKeys';
import type {
  CreatePRRequest,
  CreatePRResponse,
  GenerateCommitMessageRequest,
  GenerateCommitMessageResponse,
  GeneratePRDescriptionRequest,
  GeneratePRDescriptionResponse,
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
) {
  return useQuery({
    queryKey: queryKeys.github.pulls(owner, repo, chatId),
    queryFn: () => githubService.listPullRequests(owner, repo, chatId),
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

export function useCreatePullRequestMutation(chatId?: string) {
  return useMutation<CreatePRResponse, Error, CreatePRRequest>({
    mutationFn: (request) => githubService.createPullRequest(request, chatId),
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
