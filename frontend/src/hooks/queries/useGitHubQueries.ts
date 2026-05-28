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

export function useGitHubPullsQuery(owner: string, repo: string, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.github.pulls(owner, repo),
    queryFn: () => githubService.listPullRequests(owner, repo),
    enabled: enabled && !!owner && !!repo,
    staleTime: 30_000,
  });
}

export function useGitHubCollaboratorsQuery(owner: string, repo: string, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.github.collaborators(owner, repo),
    queryFn: () => githubService.getCollaborators(owner, repo),
    enabled: enabled && !!owner && !!repo,
    staleTime: 300_000,
  });
}

export function useCreatePullRequestMutation() {
  return useMutation<CreatePRResponse, Error, CreatePRRequest>({
    mutationFn: (request) => githubService.createPullRequest(request),
  });
}

export function useGeneratePRDescriptionMutation() {
  return useMutation<GeneratePRDescriptionResponse, Error, GeneratePRDescriptionRequest>({
    mutationFn: (request) => githubService.generatePRDescription(request),
  });
}

export function useGenerateCommitMessageMutation() {
  return useMutation<GenerateCommitMessageResponse, Error, GenerateCommitMessageRequest>({
    mutationFn: (request) => githubService.generateCommitMessage(request),
  });
}
