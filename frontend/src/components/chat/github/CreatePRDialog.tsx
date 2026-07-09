import { useState, useMemo, useRef } from 'react';
import { GitPullRequest, Sparkles } from 'lucide-react';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import { BaseModal } from '@/components/ui/shared/BaseModal/BaseModal';
import { Button } from '@/components/ui/primitives/Button/Button';
import { FloatingTooltip } from '@/components/ui/FloatingTooltip/FloatingTooltip';
import { Input } from '@/components/ui/primitives/Input/Input';
import { Link } from '@/components/ui/primitives/Link/Link';
import { Select } from '@/components/ui/primitives/Select/Select';
import { Textarea } from '@/components/ui/primitives/Textarea/Textarea';
import { useActiveChat } from '@/hooks/useActiveChat';
import { useModelStore } from '@/store/modelStore';
import { sandboxService } from '@/services/sandboxService';
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
import { CreatePRExistingBanner } from './CreatePRExistingBanner';
import { CreatePRReviewers } from './CreatePRReviewers';
import { CreatePRChangedFiles } from './CreatePRChangedFiles';
import styles from './CreatePRDialog.module.scss';

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
            className={styles['toast-link']}
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
      className={styles.dialog}
    >
      <div className={styles.body}>
        <div className={styles.header}>
          <div className={styles['icon-box']}>
            <GitPullRequest className={styles['header-icon']} />
          </div>
          <div>
            <h2 className={styles.title}>Create pull request</h2>
            {headBranch && (
              <p className={styles.subtitle}>
                {headBranch} → {baseBranch}
              </p>
            )}
          </div>
        </div>

        {!owner ? (
          <p className={styles['no-remote']}>No GitHub remote detected for this workspace.</p>
        ) : (
          <div className={styles.fields}>
            {existingPR && <CreatePRExistingBanner pr={existingPR} />}
            <div>
              <label htmlFor={titleInputId} className={styles.label}>
                Title
              </label>
              <Input
                id={titleInputId}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="PR title"
                className={styles['title-input']}
                autoFocus
              />
            </div>

            <div>
              <div className={styles['field-header']}>
                <label htmlFor={bodyTextareaId} className={styles['field-label']}>
                  Description
                </label>
                <FloatingTooltip
                  content={generateDisabledReason ?? ''}
                  className={styles['tooltip-wrap']}
                >
                  <Button
                    type="button"
                    variant="unstyled"
                    onClick={handleGenerateDescription}
                    disabled={!canGenerate}
                    className={styles['generate-button']}
                  >
                    <Sparkles
                      className={clsx(
                        styles['generate-icon'],
                        generateDescription.isPending && styles['generate-icon--pulsing'],
                      )}
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
                className={styles['description-textarea']}
              />
            </div>

            <div className={styles.row}>
              <div className={styles.col}>
                <label htmlFor={baseBranchSelectId} className={styles.label}>
                  Base branch
                </label>
                <Select
                  id={baseBranchSelectId}
                  value={baseBranch}
                  onChange={(e) => setBaseBranch(e.target.value)}
                  className={styles['base-branch-select']}
                >
                  {sortedBranches.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </Select>
              </div>

              <div className={styles.col}>
                <label className={styles.label}>Reviewers</label>
                <CreatePRReviewers
                  collaborators={collaborators}
                  selected={selectedReviewers}
                  onToggle={toggleReviewer}
                />
              </div>
            </div>

            {changedFiles.length > 0 && (
              <div>
                <label className={styles.label}>Changed files ({changedFiles.length})</label>
                <CreatePRChangedFiles files={changedFiles} />
              </div>
            )}

            {diffError && <p className={styles.notice}>{diffError}</p>}
            {!diffError && !diffData?.has_changes && (
              <p className={styles.notice}>
                No changes detected on this branch. Make sure you have committed your changes.
              </p>
            )}
          </div>
        )}
      </div>

      <div className={styles.footer}>
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
