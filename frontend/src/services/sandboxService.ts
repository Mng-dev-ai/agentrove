import { resolveSandboxClient } from '@/lib/api';
import { buildQueryString, ensureResponse, serviceCall } from '@/services/base/BaseService';
import { NotFoundError, ValidationError } from '@/services/base/ServiceError';
import type {
  DiffMode,
  FileContent,
  FileMetadata,
  GitBranchesData,
  GitChangedPathsData,
  GitCheckoutData,
  GitCommitResult,
  GitCreateBranchResult,
  GitDiffData,
  GitFileBaselineData,
  GitPushPullResult,
  GitRemoteUrlData,
  SearchParams,
  SearchResponse,
  Secret,
  UpdateFileResult,
} from '@/types/sandbox.types';
import { validateRequired } from '@/utils/validation';

async function getSandboxFilesMetadata(sandboxId: string, cwd?: string): Promise<FileMetadata[]> {
  validateRequired(sandboxId, 'Sandbox ID');

  return serviceCall(async () => {
    const qs = buildQueryString({ cwd });
    const url = `/sandbox/${sandboxId}/files/metadata${qs}`;
    const response = await resolveSandboxClient(sandboxId).get<{ files: FileMetadata[] }>(url);

    if (!response || !response.files) {
      return [];
    }

    return response.files;
  });
}

async function getFileContent(sandboxId: string, filePath: string): Promise<FileContent> {
  validateRequired(sandboxId, 'Sandbox ID');
  validateRequired(filePath, 'File path');

  return serviceCall(async () => {
    const url = `/sandbox/${sandboxId}/files/content/${filePath}`;
    const response = await resolveSandboxClient(sandboxId).get<FileContent>(url);

    if (!response) {
      throw new NotFoundError('File not found');
    }

    return response;
  });
}

async function updateFile(
  sandboxId: string,
  filePath: string,
  content: string,
): Promise<UpdateFileResult> {
  validateRequired(sandboxId, 'Sandbox ID');
  validateRequired(filePath, 'File path');
  if (content === null || content === undefined) {
    throw new ValidationError('Content is required');
  }

  return serviceCall(async () => {
    const response = await resolveSandboxClient(sandboxId).put<UpdateFileResult>(
      `/sandbox/${sandboxId}/files`,
      {
        file_path: filePath,
        content,
      },
    );

    return ensureResponse(response, 'Update file operation returned no response');
  });
}

async function getSecrets(sandboxId: string): Promise<Secret[]> {
  validateRequired(sandboxId, 'Sandbox ID');

  return serviceCall(async () => {
    const response = await resolveSandboxClient(sandboxId).get<{ secrets: Secret[] }>(
      `/sandbox/${sandboxId}/secrets`,
    );

    if (!response || !response.secrets) {
      return [];
    }

    return response.secrets;
  });
}

async function addSecret(sandboxId: string, key: string, value: string): Promise<void> {
  validateRequired(sandboxId, 'Sandbox ID');
  validateRequired(key, 'Secret key');
  validateRequired(value, 'Secret value');

  await serviceCall(async () => {
    await resolveSandboxClient(sandboxId).post(`/sandbox/${sandboxId}/secrets`, { key, value });
  });
}

async function updateSecret(sandboxId: string, key: string, value: string): Promise<void> {
  validateRequired(sandboxId, 'Sandbox ID');
  validateRequired(key, 'Secret key');
  validateRequired(value, 'Secret value');

  await serviceCall(async () => {
    await resolveSandboxClient(sandboxId).put(`/sandbox/${sandboxId}/secrets/${key}`, { value });
  });
}

async function deleteSecret(sandboxId: string, key: string): Promise<void> {
  validateRequired(sandboxId, 'Sandbox ID');
  validateRequired(key, 'Secret key');

  await serviceCall(async () => {
    await resolveSandboxClient(sandboxId).delete(`/sandbox/${sandboxId}/secrets/${key}`);
  });
}

async function downloadZip(sandboxId: string): Promise<Blob> {
  validateRequired(sandboxId, 'Sandbox ID');

  return serviceCall(async () => {
    const response = await resolveSandboxClient(sandboxId).getBlob(
      `/sandbox/${sandboxId}/download-zip`,
    );
    return ensureResponse(response, 'Download failed: No response received');
  });
}

async function getGitDiff(
  sandboxId: string,
  mode: DiffMode = 'all',
  fullContext: boolean = false,
  cwd?: string,
): Promise<GitDiffData> {
  validateRequired(sandboxId, 'Sandbox ID');

  return serviceCall(async () => {
    const qs = buildQueryString({
      mode,
      full_context: fullContext || undefined,
      cwd,
    });
    const response = await resolveSandboxClient(sandboxId).get<GitDiffData>(
      `/sandbox/${sandboxId}/git/diff${qs}`,
    );
    return ensureResponse(response, 'Failed to get git diff');
  });
}

async function getGitChangedPaths(sandboxId: string, cwd?: string): Promise<GitChangedPathsData> {
  validateRequired(sandboxId, 'Sandbox ID');

  return serviceCall(async () => {
    const qs = buildQueryString({ cwd });
    const response = await resolveSandboxClient(sandboxId).get<GitChangedPathsData>(
      `/sandbox/${sandboxId}/git/changed-paths${qs}`,
    );
    return ensureResponse(response, 'Failed to get changed paths');
  });
}

async function getGitFileBaseline(
  sandboxId: string,
  path: string,
  cwd?: string,
): Promise<GitFileBaselineData> {
  validateRequired(sandboxId, 'Sandbox ID');
  validateRequired(path, 'File path');

  return serviceCall(async () => {
    const qs = buildQueryString({ path, cwd });
    const response = await resolveSandboxClient(sandboxId).get<GitFileBaselineData>(
      `/sandbox/${sandboxId}/git/file-baseline${qs}`,
    );
    return ensureResponse(response, 'Failed to get file baseline');
  });
}

async function getGitBranches(sandboxId: string, cwd?: string): Promise<GitBranchesData> {
  validateRequired(sandboxId, 'Sandbox ID');

  return serviceCall(async () => {
    const qs = buildQueryString({ cwd });
    const response = await resolveSandboxClient(sandboxId).get<GitBranchesData>(
      `/sandbox/${sandboxId}/git/branches${qs}`,
    );
    return ensureResponse(response, 'Failed to get git branches');
  });
}

async function checkoutGitBranch(
  sandboxId: string,
  branch: string,
  cwd?: string,
): Promise<GitCheckoutData> {
  validateRequired(sandboxId, 'Sandbox ID');
  validateRequired(branch, 'Branch name');

  return serviceCall(async () => {
    const response = await resolveSandboxClient(sandboxId).post<GitCheckoutData>(
      `/sandbox/${sandboxId}/git/checkout`,
      {
        branch,
        cwd: cwd ?? null,
      },
    );
    return ensureResponse(response, 'Checkout failed');
  });
}

async function gitCommit(
  sandboxId: string,
  message: string,
  cwd?: string,
): Promise<GitCommitResult> {
  validateRequired(sandboxId, 'Sandbox ID');
  validateRequired(message, 'Commit message');

  return serviceCall(async () => {
    const response = await resolveSandboxClient(sandboxId).post<GitCommitResult>(
      `/sandbox/${sandboxId}/git/commit`,
      {
        message,
        cwd: cwd ?? null,
      },
    );
    return ensureResponse(response, 'Commit failed');
  });
}

async function gitPush(sandboxId: string, cwd?: string): Promise<GitPushPullResult> {
  validateRequired(sandboxId, 'Sandbox ID');

  return serviceCall(async () => {
    const qs = buildQueryString({ cwd });
    const response = await resolveSandboxClient(sandboxId).post<GitPushPullResult>(
      `/sandbox/${sandboxId}/git/push${qs}`,
    );
    return ensureResponse(response, 'Push failed');
  });
}

async function gitPull(sandboxId: string, cwd?: string): Promise<GitPushPullResult> {
  validateRequired(sandboxId, 'Sandbox ID');

  return serviceCall(async () => {
    const qs = buildQueryString({ cwd });
    const response = await resolveSandboxClient(sandboxId).post<GitPushPullResult>(
      `/sandbox/${sandboxId}/git/pull${qs}`,
    );
    return ensureResponse(response, 'Pull failed');
  });
}

async function gitRestoreFile(
  sandboxId: string,
  filePath: string,
  oldPath?: string,
  cwd?: string,
): Promise<GitCommitResult> {
  validateRequired(sandboxId, 'Sandbox ID');
  validateRequired(filePath, 'File path');

  return serviceCall(async () => {
    const response = await resolveSandboxClient(sandboxId).post<GitCommitResult>(
      `/sandbox/${sandboxId}/git/restore-file`,
      {
        file_path: filePath,
        old_path: oldPath ?? null,
        cwd: cwd ?? null,
      },
    );
    return ensureResponse(response, 'Restore file failed');
  });
}

async function gitRestoreAll(sandboxId: string, cwd?: string): Promise<GitCommitResult> {
  validateRequired(sandboxId, 'Sandbox ID');

  return serviceCall(async () => {
    const qs = buildQueryString({ cwd });
    const response = await resolveSandboxClient(sandboxId).post<GitCommitResult>(
      `/sandbox/${sandboxId}/git/restore-all${qs}`,
    );
    return ensureResponse(response, 'Restore all failed');
  });
}

async function gitCreateBranch(
  sandboxId: string,
  name: string,
  baseBranch?: string,
  cwd?: string,
): Promise<GitCreateBranchResult> {
  validateRequired(sandboxId, 'Sandbox ID');
  validateRequired(name, 'Branch name');

  return serviceCall(async () => {
    const response = await resolveSandboxClient(sandboxId).post<GitCreateBranchResult>(
      `/sandbox/${sandboxId}/git/create-branch`,
      { name, base_branch: baseBranch ?? null, cwd: cwd ?? null },
    );
    return ensureResponse(response, 'Failed to create branch');
  });
}

async function getGitRemoteUrl(sandboxId: string, cwd?: string): Promise<GitRemoteUrlData> {
  validateRequired(sandboxId, 'Sandbox ID');

  return serviceCall(async () => {
    const qs = buildQueryString({ cwd });
    const response = await resolveSandboxClient(sandboxId).get<GitRemoteUrlData>(
      `/sandbox/${sandboxId}/git/remote-url${qs}`,
    );
    return ensureResponse(response, 'Failed to get remote URL');
  });
}

async function searchInFiles(sandboxId: string, params: SearchParams): Promise<SearchResponse> {
  validateRequired(sandboxId, 'Sandbox ID');
  validateRequired(params.query, 'Search query');

  return serviceCall(async () => {
    const qs = buildQueryString({
      q: params.query,
      cwd: params.cwd,
      case_sensitive: params.caseSensitive || undefined,
      regex: params.regex || undefined,
      whole_word: params.wholeWord || undefined,
      include: params.include || undefined,
      exclude: params.exclude || undefined,
    });
    const response = await resolveSandboxClient(sandboxId).get<SearchResponse>(
      `/sandbox/${sandboxId}/search${qs}`,
    );
    return ensureResponse(response, 'Failed to search files');
  });
}

export const sandboxService = {
  getSandboxFilesMetadata,
  getFileContent,
  updateFile,
  getSecrets,
  addSecret,
  updateSecret,
  deleteSecret,
  downloadZip,
  getGitDiff,
  getGitChangedPaths,
  getGitFileBaseline,
  getGitBranches,
  checkoutGitBranch,
  gitCommit,
  gitPush,
  gitPull,
  gitCreateBranch,
  gitRestoreFile,
  gitRestoreAll,
  getGitRemoteUrl,
  searchInFiles,
};
