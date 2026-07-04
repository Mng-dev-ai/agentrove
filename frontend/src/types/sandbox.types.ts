export interface Secret {
  key: string;
  value: string;
  originalKey?: string;
  originalValue?: string;
  isNew?: boolean;
  isModified?: boolean;
  isDeleted?: boolean;
}

export interface TerminalSize {
  cols: number;
  rows: number;
}

export interface FileMetadata {
  path: string;
  type: string;
  is_binary?: boolean;
}

export interface FileContent {
  path: string;
  content: string;
  type: string;
  is_binary: boolean;
}

export interface UpdateFileResult {
  success: boolean;
  message: string;
}

export type DiffMode = 'all' | 'staged' | 'unstaged' | 'branch';

export interface GitDiffData {
  diff: string;
  has_changes: boolean;
  is_git_repo: boolean;
  error?: string;
}

export interface GitFileBaselineData {
  path: string;
  content: string;
  is_git_repo: boolean;
}

export interface GitChangedPathsData {
  paths: string[];
  is_git_repo: boolean;
}

export interface GitBranchesData {
  branches: string[];
  current_branch: string;
  is_git_repo: boolean;
}

export interface GitCheckoutData {
  success: boolean;
  current_branch: string;
  error?: string;
}

export interface GitCommitResult {
  success: boolean;
  output: string;
  error?: string;
}

export interface GitPushPullResult {
  success: boolean;
  output: string;
  error?: string;
}

export interface GitCreateBranchResult {
  success: boolean;
  current_branch: string;
  error?: string;
}

export type ChangedFileStatus = 'M' | 'A' | 'D';

export interface ChangedFile {
  path: string;
  status: ChangedFileStatus;
  additions: number;
  deletions: number;
}

export interface ChangedFilesData {
  files: ChangedFile[];
  cwd: string;
}

export interface FileDiffData {
  path: string;
  diff: string;
}

export interface GitRemoteUrlData {
  owner: string;
  repo: string;
  remote_url: string;
}

export interface SearchMatch {
  line_number: number;
  line_text: string;
  match_start: number;
  match_end: number;
}

export interface SearchFileResult {
  path: string;
  matches: SearchMatch[];
}

export interface SearchResponse {
  results: SearchFileResult[];
  truncated: boolean;
}

export interface SearchParams {
  query: string;
  cwd?: string;
  caseSensitive?: boolean;
  regex?: boolean;
  wholeWord?: boolean;
  include?: string;
  exclude?: string;
}
