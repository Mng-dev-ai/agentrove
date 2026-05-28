import { apiClient } from '@/lib/api';
import { ensureResponse, withAuth, buildQueryString } from '@/services/base/BaseService';
import type {
  GitHubReposResponse,
  GitHubPRListResponse,
  CreatePRRequest,
  CreatePRResponse,
  GenerateCommitMessageRequest,
  GenerateCommitMessageResponse,
  GeneratePRDescriptionRequest,
  GeneratePRDescriptionResponse,
} from '@/types/github.types';

async function searchRepositories(
  query: string,
  page: number,
  perPage: number,
): Promise<GitHubReposResponse> {
  return withAuth(async () => {
    const qs = buildQueryString({ q: query, page, per_page: perPage });
    const response = await apiClient.get<GitHubReposResponse>(`/github/repositories${qs}`);
    return ensureResponse(response, 'Failed to fetch GitHub repositories');
  });
}

async function listPullRequests(owner: string, repo: string): Promise<GitHubPRListResponse> {
  return withAuth(async () => {
    const qs = buildQueryString({ owner, repo });
    const response = await apiClient.get<GitHubPRListResponse>(`/github/pulls${qs}`);
    return ensureResponse(response, 'Failed to fetch pull requests');
  });
}

async function createPullRequest(request: CreatePRRequest): Promise<CreatePRResponse> {
  return withAuth(async () => {
    const response = await apiClient.post<CreatePRResponse>('/github/pulls', request);
    return ensureResponse(response, 'Failed to create pull request');
  });
}

async function generatePRDescription(
  request: GeneratePRDescriptionRequest,
): Promise<GeneratePRDescriptionResponse> {
  return withAuth(async () => {
    const response = await apiClient.post<GeneratePRDescriptionResponse>(
      '/github/generate-pr-description',
      request,
    );
    return ensureResponse(response, 'Failed to generate PR description');
  });
}

async function generateCommitMessage(
  request: GenerateCommitMessageRequest,
): Promise<GenerateCommitMessageResponse> {
  return withAuth(async () => {
    const response = await apiClient.post<GenerateCommitMessageResponse>(
      '/github/generate-commit-message',
      request,
    );
    return ensureResponse(response, 'Failed to generate commit message');
  });
}

async function getCollaborators(
  owner: string,
  repo: string,
): Promise<Array<{ login: string; avatar_url: string }>> {
  return withAuth(async () => {
    const qs = buildQueryString({ owner, repo });
    const response = await apiClient.get<Array<{ login: string; avatar_url: string }>>(
      `/github/collaborators${qs}`,
    );
    return ensureResponse(response, 'Failed to fetch collaborators');
  });
}

export const githubService = {
  searchRepositories,
  listPullRequests,
  createPullRequest,
  generatePRDescription,
  generateCommitMessage,
  getCollaborators,
};
