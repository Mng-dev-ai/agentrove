import { apiClient, resolveChatClient } from '@/lib/api';
import {
  ensureResponse,
  serviceCall,
  withAuth,
  buildQueryString,
} from '@/services/base/BaseService';
import type {
  GitHubReposResponse,
  GitHubPRListResponse,
  GitHubCollaborator,
  CreatePRRequest,
  CreatePRResponse,
  GenerateCommitMessageRequest,
  GenerateCommitMessageResponse,
  GeneratePRDescriptionRequest,
  GeneratePRDescriptionResponse,
} from '@/types/github.types';

// Repo search is local-only (no chat yet) → withAuth. Chat git ops route by
// chat ownership via serviceCall (withAuth would kill local session on VPS 401).
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

async function listPullRequests(
  owner: string,
  repo: string,
  chatId?: string,
): Promise<GitHubPRListResponse> {
  return serviceCall(async () => {
    const qs = buildQueryString({ owner, repo });
    const response = await resolveChatClient(chatId).get<GitHubPRListResponse>(
      `/github/pulls${qs}`,
    );
    return ensureResponse(response, 'Failed to fetch pull requests');
  });
}

async function createPullRequest(
  request: CreatePRRequest,
  chatId?: string,
): Promise<CreatePRResponse> {
  return serviceCall(async () => {
    const response = await resolveChatClient(chatId).post<CreatePRResponse>(
      '/github/pulls',
      request,
    );
    return ensureResponse(response, 'Failed to create pull request');
  });
}

async function generatePRDescription(
  request: GeneratePRDescriptionRequest,
  chatId?: string,
): Promise<GeneratePRDescriptionResponse> {
  return serviceCall(async () => {
    const response = await resolveChatClient(chatId).post<GeneratePRDescriptionResponse>(
      '/github/generate-pr-description',
      request,
    );
    return ensureResponse(response, 'Failed to generate PR description');
  });
}

async function generateCommitMessage(
  request: GenerateCommitMessageRequest,
  chatId?: string,
): Promise<GenerateCommitMessageResponse> {
  return serviceCall(async () => {
    const response = await resolveChatClient(chatId).post<GenerateCommitMessageResponse>(
      '/github/generate-commit-message',
      request,
    );
    return ensureResponse(response, 'Failed to generate commit message');
  });
}

async function getCollaborators(
  owner: string,
  repo: string,
  chatId?: string,
): Promise<GitHubCollaborator[]> {
  return serviceCall(async () => {
    const qs = buildQueryString({ owner, repo });
    const response = await resolveChatClient(chatId).get<GitHubCollaborator[]>(
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
