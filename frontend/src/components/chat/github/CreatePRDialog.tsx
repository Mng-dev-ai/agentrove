import { useState, useMemo, useRef } from 'react';
import { ExternalLink, GitPullRequest, Sparkles } from 'lucide-react';
import toast from 'react-hot-toast';
import { BaseModal } from '@/components/ui/shared/BaseModal';
import { Button } from '@/components/ui/primitives/Button/Button';
import { FloatingTooltip } from '@/components/ui/FloatingTooltip';
import { Input } from '@/components/ui/primitives/Input/Input';
import { Link } from '@/components/ui/primitives/Link/Link';
import { Select } from '@/components/ui/primitives/Select/Select';
import { Textarea } from '@/components/ui/primitives/Textarea/Textarea';
import { useActiveChat } from '@/hooks/useActiveChat';
import { useModelStore } from '@/store/modelStore';
import { sandboxService } from '@/services/sandboxService';
import { openExternalUrl } from '@/utils/openExternal';
import { MAX_DIFF_LENGTH } from '@/config/constants';
import {
  useGitBranchesQuery,
  useGitDiffQuery,
  useGitRemoteUrlQuery,
} from '@/hooks/queries/useSandboxQueries';
import {
  useGitHubCollaboratorsQuery,
  useGitHubPullsQuery,
  useCreatePullRequestMutation,
  useGeneratePRDescriptionMutation,
} from '@/hooks/queries/useGitHubQueries';

interface CreatePRDialogProps {
  onClose: () => void;
}

const DIFF_HEADER_RE = /^a\/(.+?) b\//;
const DEFAULT_BASES = ['main', 'master', 'develop', 'trunk'];

function parseChangedFiles(
  diff: string,
): Array<{ path: string; additions: number; deletions: number }> {
  const files: Array<{ path: string; additions: number; deletions: number }> = [];
  const chunks = diff.split(/^diff --git /m);
  for (const chunk of chunks) {
    if (!chunk.trim()) continue;
    const headerMatch = chunk.match(DIFF_HEADER_RE);
    if (!headerMatch) continue;
    const path = headerMatch[1];
    let additions = 0;
    let deletions = 0;
    for (const line of chunk.split('\n')) {
      if (line[0] === '+' && !line.startsWith('+++')) additions++;
      else if (line[0] === '-' && !line.startsWith('---')) deletions++;
    }
    files.push({ path, additions, deletions });
  }
  return files;
}

export function CreatePRDialog({ onClose }: CreatePRDialogProps) {
  const currentChat = useActiveChat();
  const sandboxId = currentChat?.sandbox_id ?? '';
  const worktreeCwd = currentChat?.worktree_cwd ?? undefined;

  const { data: remoteUrl } = useGitRemoteUrlQuery(sandboxId, !!sandboxId, worktreeCwd);
  const owner = remoteUrl?.owner ?? '';
  const repo = remoteUrl?.repo ?? '';

  const { data: branchesData } = useGitBranchesQuery(sandboxId, !!sandboxId, worktreeCwd);
  const { data: diffData } = useGitDiffQuery(sandboxId, 'branch', false, worktreeCwd);
  const { data: collaborators } = useGitHubCollaboratorsQuery(owner, repo, !!owner && !!repo);
  const { data: pullsData } = useGitHubPullsQuery(owner, repo, !!owner && !!repo);

  const changedFiles = useMemo(
    () => (diffData?.diff ? parseChangedFiles(diffData.diff) : []),
    [diffData?.diff],
  );

  const defaultBody = useMemo(() => {
    const parts: string[] = [];
    if (changedFiles.length > 0) {
      parts.push('**Changed files:**');
      for (const f of changedFiles.slice(0, 15)) {
        const stat = `+${f.additions} −${f.deletions}`;
        parts.push(`- \`${f.path}\` (${stat})`);
      }
      if (changedFiles.length > 15) {
        parts.push(`- ...and ${changedFiles.length - 15} more`);
      }
    }
    return parts.join('\n');
  }, [changedFiles]);

  const headBranch = branchesData?.current_branch ?? '';
  const repoFullName = owner && repo ? `${owner}/${repo}` : '';
  const existingPR = useMemo(
    () =>
      headBranch && repoFullName
        ? pullsData?.items.find(
            (pr) => pr.head.ref === headBranch && pr.head.repo.full_name === repoFullName,
          )
        : undefined,
    [pullsData?.items, headBranch, repoFullName],
  );
  const sortedBranches = useMemo(() => {
    const candidates = branchesData?.branches.filter((b) => b !== headBranch) ?? [];
    const defaults = candidates
      .filter((b) => DEFAULT_BASES.includes(b))
      .sort((a, b) => DEFAULT_BASES.indexOf(a) - DEFAULT_BASES.indexOf(b));
    const rest = candidates.filter((b) => !DEFAULT_BASES.includes(b));
    return [...defaults, ...rest];
  }, [branchesData?.branches, headBranch]);

  const detectedBase = sortedBranches.find((b) => DEFAULT_BASES.includes(b)) ?? '';

  const [title, setTitle] = useState(currentChat?.title?.slice(0, 72) ?? '');
  const [body, setBody] = useState(defaultBody);
  const [baseBranch, setBaseBranch] = useState('');
  const [selectedReviewers, setSelectedReviewers] = useState<string[]>([]);
  const bodyEditedRef = useRef(false);

  const prevDefaultBodyRef = useRef(defaultBody);
  if (prevDefaultBodyRef.current !== defaultBody && !bodyEditedRef.current) {
    prevDefaultBodyRef.current = defaultBody;
    setBody(defaultBody);
  }

  if (!baseBranch && detectedBase) {
    setBaseBranch(detectedBase);
  }

  // Resolve the model from the active git chat (modelStore is keyed per chat), not
  // the primary chat session — in split view this dialog targets the secondary pane.
  const selectedModelId = useModelStore((s) =>
    currentChat ? (s.modelByChat[currentChat.id] ?? '') : '',
  );
  const createPR = useCreatePullRequestMutation();
  const generateDescription = useGeneratePRDescriptionMutation();
  const hasDiff = !!diffData?.diff;
  const diffError = diffData?.error;
  const hasModel = !!selectedModelId.trim();
  const canGenerate = hasDiff && hasModel && !generateDescription.isPending;
  const generateDisabledReason = !hasModel
    ? 'Select a model first'
    : !hasDiff
      ? (diffError ?? 'Commit your changes first')
      : undefined;
  const titleInputId = 'create-pr-title';
  const bodyTextareaId = 'create-pr-description';
  const baseBranchSelectId = 'create-pr-base-branch';

  const handleGenerateDescription = async () => {
    if (!diffData?.diff) return;
    const rawDiff = diffData.diff;
    const diff =
      rawDiff.length > MAX_DIFF_LENGTH
        ? rawDiff.slice(0, MAX_DIFF_LENGTH) + '\n\n(diff truncated)'
        : rawDiff;
    try {
      const result = await generateDescription.mutateAsync({
        title: title || 'Untitled PR',
        diff,
        model_id: selectedModelId,
      });
      bodyEditedRef.current = true;
      setBody(result.description);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to generate description');
    }
  };

  const handleSubmit = async () => {
    if (!title.trim()) {
      toast.error('Please enter a title');
      return;
    }
    if (!owner || !repo) {
      toast.error('Could not detect GitHub repository');
      return;
    }
    if (!headBranch) {
      toast.error('Could not detect current branch');
      return;
    }
    if (!baseBranch.trim()) {
      toast.error('Please select a base branch');
      return;
    }

    try {
      const pushResult = await sandboxService.gitPush(sandboxId, worktreeCwd);
      if (!pushResult.success) {
        toast.error(`Push failed: ${pushResult.error || 'Could not push branch to remote'}`);
        return;
      }

      const result = await createPR.mutateAsync({
        owner,
        repo,
        title: title.trim(),
        body,
        head: headBranch,
        base: baseBranch,
        reviewers: selectedReviewers,
      });
      toast.success(
        <span>
          Created PR #{result.number}:{' '}
          <Link
            href={result.html_url}
            variant="unstyled"
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            View on GitHub
          </Link>
        </span>,
        { duration: 6000 },
      );
      if (result.reviewer_warning) {
        toast.error(result.reviewer_warning, { duration: 5000 });
      }
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to create pull request');
    }
  };

  const toggleReviewer = (login: string) => {
    setSelectedReviewers((prev) =>
      prev.includes(login) ? prev.filter((r) => r !== login) : [...prev, login],
    );
  };

  return (
    <BaseModal
      isOpen={true}
      onClose={onClose}
      size="md"
      zIndex="modalHighest"
      className="overflow-visible"
    >
      <div className="p-5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-surface-tertiary dark:bg-surface-dark-tertiary">
            <GitPullRequest className="h-4 w-4 text-text-tertiary dark:text-text-dark-tertiary" />
          </div>
          <div>
            <h2 className="text-sm font-medium text-text-primary dark:text-text-dark-primary">
              Create pull request
            </h2>
            {headBranch && (
              <p className="font-mono text-2xs text-text-tertiary dark:text-text-dark-tertiary">
                {headBranch} → {baseBranch}
              </p>
            )}
          </div>
        </div>

        {!owner ? (
          <p className="mt-4 text-xs text-text-tertiary dark:text-text-dark-tertiary">
            No GitHub remote detected for this workspace.
          </p>
        ) : (
          <div className="mt-4 space-y-3">
            {existingPR && (
              <div className="flex items-center justify-between rounded-lg border border-border/50 bg-surface-secondary px-3 py-2.5 dark:border-border-dark/50 dark:bg-surface-dark-secondary">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-text-primary dark:text-text-dark-primary">
                    PR #{existingPR.number} already exists for this branch
                  </p>
                  <p className="truncate text-2xs text-text-tertiary dark:text-text-dark-tertiary">
                    {existingPR.title}
                  </p>
                </div>
                <Button
                  variant="unstyled"
                  type="button"
                  onClick={() => openExternalUrl(existingPR.html_url)}
                  className="ml-3 flex flex-shrink-0 items-center gap-1 rounded-md px-2 py-1 text-2xs text-text-secondary transition-colors duration-200 hover:bg-surface-hover dark:text-text-dark-secondary dark:hover:bg-surface-dark-hover"
                >
                  View on GitHub
                  <ExternalLink className="h-3 w-3" />
                </Button>
              </div>
            )}
            <div>
              <label
                htmlFor={titleInputId}
                className="mb-1.5 block text-2xs font-medium uppercase tracking-wider text-text-quaternary dark:text-text-dark-quaternary"
              >
                Title
              </label>
              <Input
                id={titleInputId}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="PR title"
                className="bg-surface-secondary px-3 py-1.5 text-xs dark:bg-surface-dark-secondary"
                autoFocus
              />
            </div>

            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label
                  htmlFor={bodyTextareaId}
                  className="text-2xs font-medium uppercase tracking-wider text-text-quaternary dark:text-text-dark-quaternary"
                >
                  Description
                </label>
                <FloatingTooltip content={generateDisabledReason ?? ''} className="flex">
                  <Button
                    type="button"
                    variant="unstyled"
                    onClick={handleGenerateDescription}
                    disabled={!canGenerate}
                    className={`flex items-center gap-1 rounded-md px-1.5 py-0.5 text-2xs text-text-tertiary transition-colors duration-200 dark:text-text-dark-tertiary ${
                      canGenerate
                        ? 'hover:bg-surface-hover hover:text-text-secondary dark:hover:bg-surface-dark-hover dark:hover:text-text-dark-primary'
                        : 'cursor-not-allowed opacity-50'
                    }`}
                  >
                    <Sparkles
                      className={`h-3 w-3 ${generateDescription.isPending ? 'animate-pulse' : ''}`}
                    />
                    {generateDescription.isPending ? 'Generating...' : 'Generate with AI'}
                  </Button>
                </FloatingTooltip>
              </div>
              <Textarea
                id={bodyTextareaId}
                value={body}
                onChange={(e) => {
                  bodyEditedRef.current = true;
                  setBody(e.target.value);
                }}
                rows={5}
                className="resize-none bg-surface-secondary px-3 py-2 text-xs dark:bg-surface-dark-secondary"
              />
            </div>

            <div className="flex gap-3">
              <div className="flex-1">
                <label
                  htmlFor={baseBranchSelectId}
                  className="mb-1.5 block text-2xs font-medium uppercase tracking-wider text-text-quaternary dark:text-text-dark-quaternary"
                >
                  Base branch
                </label>
                <Select
                  id={baseBranchSelectId}
                  value={baseBranch}
                  onChange={(e) => setBaseBranch(e.target.value)}
                  className="bg-surface-secondary px-3 py-1.5 text-xs dark:bg-surface-dark-secondary"
                >
                  {sortedBranches.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </Select>
              </div>

              <div className="flex-1">
                <label className="mb-1.5 block text-2xs font-medium uppercase tracking-wider text-text-quaternary dark:text-text-dark-quaternary">
                  Reviewers
                </label>
                <div className="flex flex-wrap gap-1 rounded-lg border border-border/50 bg-surface-secondary px-2 py-1 dark:border-border-dark/50 dark:bg-surface-dark-secondary">
                  {!collaborators || collaborators.length === 0 ? (
                    <span className="px-1 py-0.5 text-2xs text-text-quaternary dark:text-text-dark-quaternary">
                      No collaborators
                    </span>
                  ) : (
                    collaborators.map((c) => (
                      <Button
                        variant="unstyled"
                        key={c.login}
                        type="button"
                        onClick={() => toggleReviewer(c.login)}
                        className={`rounded px-1.5 py-0.5 text-2xs transition-colors duration-200 ${
                          selectedReviewers.includes(c.login)
                            ? 'bg-text-primary text-surface dark:bg-text-dark-primary dark:text-surface-dark'
                            : 'text-text-secondary hover:bg-surface-hover dark:text-text-dark-secondary dark:hover:bg-surface-dark-hover'
                        }`}
                      >
                        {c.login}
                      </Button>
                    ))
                  )}
                </div>
              </div>
            </div>

            {changedFiles.length > 0 && (
              <div>
                <label className="mb-1.5 block text-2xs font-medium uppercase tracking-wider text-text-quaternary dark:text-text-dark-quaternary">
                  Changed files ({changedFiles.length})
                </label>
                <div className="max-h-28 overflow-y-auto rounded-lg border border-border/50 bg-surface-secondary p-2 dark:border-border-dark/50 dark:bg-surface-dark-secondary">
                  {changedFiles.map((f) => (
                    <div
                      key={f.path}
                      className="flex items-center justify-between py-0.5 font-mono text-2xs text-text-secondary dark:text-text-dark-secondary"
                    >
                      <span className="truncate">{f.path}</span>
                      <span className="ml-2 flex-shrink-0 text-text-quaternary dark:text-text-dark-quaternary">
                        +{f.additions} −{f.deletions}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {diffError && (
              <p className="text-xs text-text-quaternary dark:text-text-dark-quaternary">
                {diffError}
              </p>
            )}
            {!diffError && !diffData?.has_changes && (
              <p className="text-xs text-text-quaternary dark:text-text-dark-quaternary">
                No changes detected on this branch. Make sure you have committed your changes.
              </p>
            )}
          </div>
        )}
      </div>

      <div className="flex justify-end gap-2 border-t border-border/50 px-5 py-3.5 dark:border-border-dark/50">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onClose}
          disabled={createPR.isPending}
        >
          Cancel
        </Button>
        <Button
          type="button"
          variant="primary"
          size="sm"
          onClick={handleSubmit}
          disabled={createPR.isPending || !owner || !!existingPR}
        >
          {createPR.isPending ? 'Creating...' : 'Create pull request'}
        </Button>
      </div>
    </BaseModal>
  );
}
