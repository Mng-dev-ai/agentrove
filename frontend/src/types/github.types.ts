export interface GitHubRepo {
  name: string;
  full_name: string;
  description: string | null;
  language: string | null;
  html_url: string;
  clone_url: string;
  private: boolean;
  pushed_at: string | null;
}

export interface GitHubReposResponse {
  items: GitHubRepo[];
  has_more: boolean;
}

export type PullRequestStateFilter = 'open' | 'closed' | 'all';

export interface PullRequestFilters {
  head?: string;
  state?: PullRequestStateFilter;
}

interface GitHubPullRequest {
  number: number;
  title: string;
  body: string | null;
  state: string;
  html_url: string;
  head: { ref: string; sha: string; repo: { full_name: string } };
  base: { ref: string };
  user: { login: string; avatar_url: string };
  draft: boolean;
  merged: boolean;
}

export interface GitHubPRListResponse {
  items: GitHubPullRequest[];
}

export interface GitHubCollaborator {
  login: string;
}

export interface CreatePRRequest {
  owner: string;
  repo: string;
  title: string;
  body: string;
  head: string;
  base: string;
  reviewers: string[];
}

export interface CreatePRResponse {
  number: number;
  html_url: string;
  title: string;
  reviewer_warning?: string;
}

export interface GeneratePRDescriptionRequest {
  title: string;
  diff: string;
  model_id: string;
}

export interface GeneratePRDescriptionResponse {
  description: string;
}

export interface GenerateCommitMessageRequest {
  diff: string;
  model_id: string;
}

export interface GenerateCommitMessageResponse {
  message: string;
}
