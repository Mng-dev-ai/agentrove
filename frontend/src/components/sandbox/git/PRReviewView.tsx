import { memo, useState, useCallback } from 'react';
import { Inbox, RefreshCw, ChevronRight, MessageSquare } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Spinner } from '@/components/ui/primitives/Spinner';
import { useChatStore } from '@/store/chatStore';
import { useUIStore } from '@/store/uiStore';
import { useGitRemoteUrlQuery } from '@/hooks/queries/useSandboxQueries';
import { useGitHubPullsQuery, useGitHubPRCommentsQuery } from '@/hooks/queries/useGitHubQueries';
import { queryKeys } from '@/hooks/queries/queryKeys';
import { Button } from '@/components/ui/primitives/Button';
import { cn } from '@/utils/cn';
import { openExternalUrl } from '@/utils/openExternal';

type ReviewComment = {
  path: string | null;
  line: number | null;
  user: { login: string };
  body: string;
};

function PRComments({
  owner,
  repo,
  number,
  workspaceId,
  chatId,
  headRef,
}: {
  owner: string;
  repo: string;
  number: number;
  workspaceId?: string;
  chatId?: string;
  headRef?: string;
}) {
  const navigate = useNavigate();
  const { data, isLoading, isError } = useGitHubPRCommentsQuery(owner, repo, number, true);

  const buildPrompt = useCallback(
    (comment: ReviewComment) => {
      const branchHint = headRef ? `\nBranch: ${headRef}` : '';
      return `Fix this review comment on PR #${number}:${branchHint}\n\nFile: ${comment.path ?? 'unknown'}${comment.line ? `:${comment.line}` : ''}\nComment by @${comment.user.login}:\n${comment.body}`;
    },
    [number, headRef],
  );

  const handleFixInThisChat = useCallback(
    (comment: ReviewComment) => {
      if (!chatId) return;
      useUIStore.getState().setPendingChatMessage({
        chatId,
        message: buildPrompt(comment),
      });
    },
    [buildPrompt, chatId],
  );

  const handleFixInNewChat = useCallback(
    (comment: ReviewComment) => {
      navigate('/', { state: { initialMessage: buildPrompt(comment), workspaceId } });
    },
    [navigate, workspaceId, buildPrompt],
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-4">
        <Spinner size="sm" className="text-text-quaternary dark:text-text-dark-quaternary" />
      </div>
    );
  }

  if (isError) {
    return (
      <p className="text-error dark:text-error-dark py-3 text-center text-2xs">
        Failed to load review comments
      </p>
    );
  }

  if (!data?.comments.length) {
    return (
      <p className="py-3 text-center text-2xs text-text-quaternary dark:text-text-dark-quaternary">
        No review comments
      </p>
    );
  }

  return (
    <div className="space-y-2 pb-2">
      {data.comments.map((comment) => (
        <div
          key={comment.id}
          className="rounded-lg border border-border/50 p-2.5 dark:border-border-dark/50"
        >
          <div className="flex items-center gap-1.5 text-2xs">
            <span className="font-medium text-text-primary dark:text-text-dark-primary">
              {comment.user.login}
            </span>
            {comment.path && (
              <span className="font-mono text-text-quaternary dark:text-text-dark-quaternary">
                {comment.path}
                {comment.line ? `:${comment.line}` : ''}
              </span>
            )}
          </div>
          <p className="mt-1 text-xs leading-relaxed text-text-secondary dark:text-text-dark-secondary">
            {comment.body}
          </p>
          <div className="mt-1.5 flex gap-1.5">
            <Button
              variant="unstyled"
              type="button"
              onClick={() => handleFixInThisChat(comment)}
              className="rounded px-2 py-0.5 text-2xs font-medium text-text-secondary transition-colors duration-200 hover:bg-surface-hover hover:text-text-primary dark:text-text-dark-secondary dark:hover:bg-surface-dark-hover dark:hover:text-text-dark-primary"
            >
              Fix in this chat
            </Button>
            <Button
              variant="unstyled"
              type="button"
              onClick={() => handleFixInNewChat(comment)}
              className="rounded px-2 py-0.5 text-2xs font-medium text-text-secondary transition-colors duration-200 hover:bg-surface-hover hover:text-text-primary dark:text-text-dark-secondary dark:hover:bg-surface-dark-hover dark:hover:text-text-dark-primary"
            >
              Fix in new chat
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}

export const PRReviewView = memo(function PRReviewView() {
  const currentChat = useChatStore((s) => s.currentChat);
  const sandboxId = currentChat?.sandbox_id ?? '';
  const worktreeCwd = currentChat?.worktree_cwd ?? undefined;
  const queryClient = useQueryClient();

  const { data: remoteUrl } = useGitRemoteUrlQuery(sandboxId, !!sandboxId, worktreeCwd);
  const owner = remoteUrl?.owner ?? '';
  const repo = remoteUrl?.repo ?? '';

  const {
    data: pullsData,
    isLoading,
    isError,
    error: pullsError,
  } = useGitHubPullsQuery(owner, repo, !!owner && !!repo);

  const [expandedPR, setExpandedPR] = useState<number | null>(null);

  const handleRefresh = useCallback(() => {
    if (owner && repo) {
      queryClient.invalidateQueries({ queryKey: queryKeys.github.pulls(owner, repo) });
      if (expandedPR !== null) {
        queryClient.invalidateQueries({
          queryKey: queryKeys.github.prComments(owner, repo, expandedPR),
        });
      }
    }
  }, [queryClient, owner, repo, expandedPR]);

  return (
    <div className="flex h-full w-full flex-col bg-surface-secondary dark:bg-surface-dark-secondary">
      <div className="flex h-9 flex-shrink-0 items-center justify-between border-b border-border/50 px-3 dark:border-border-dark/50">
        <div className="flex items-center gap-2">
          <Inbox className="h-3.5 w-3.5 text-text-tertiary dark:text-text-dark-tertiary" />
          <span className="text-2xs font-medium uppercase tracking-wider text-text-quaternary dark:text-text-dark-quaternary">
            Pull requests
          </span>
          {owner && repo && (
            <span className="font-mono text-2xs text-text-quaternary dark:text-text-dark-quaternary">
              {owner}/{repo}
            </span>
          )}
        </div>
        <Button
          variant="unstyled"
          type="button"
          onClick={handleRefresh}
          className="flex h-5 w-5 items-center justify-center rounded text-text-tertiary transition-colors duration-200 hover:text-text-primary dark:text-text-dark-tertiary dark:hover:text-text-dark-primary"
        >
          <RefreshCw className="h-3 w-3" />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {!owner ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Inbox className="h-5 w-5 text-text-quaternary dark:text-text-dark-quaternary" />
            <p className="mt-2 text-xs text-text-quaternary dark:text-text-dark-quaternary">
              No GitHub remote detected
            </p>
          </div>
        ) : isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Spinner size="md" className="text-text-quaternary dark:text-text-dark-quaternary" />
          </div>
        ) : isError ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Inbox className="h-5 w-5 text-text-quaternary dark:text-text-dark-quaternary" />
            <p className="text-error dark:text-error-dark mt-2 text-xs">
              Failed to load pull requests
            </p>
            <p className="mt-1 text-2xs text-text-quaternary dark:text-text-dark-quaternary">
              {pullsError?.message}
            </p>
          </div>
        ) : !pullsData?.items.length ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Inbox className="h-5 w-5 text-text-quaternary dark:text-text-dark-quaternary" />
            <p className="mt-2 text-xs text-text-quaternary dark:text-text-dark-quaternary">
              No open pull requests
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {pullsData.items.map((pr) => {
              const isExpanded = expandedPR === pr.number;
              return (
                <div
                  key={pr.number}
                  className="rounded-lg border border-border/50 dark:border-border-dark/50"
                >
                  <Button
                    variant="unstyled"
                    type="button"
                    onClick={() => setExpandedPR(isExpanded ? null : pr.number)}
                    className="flex w-full items-center gap-2.5 p-2.5 text-left transition-colors duration-200 hover:bg-surface-hover dark:hover:bg-surface-dark-hover"
                  >
                    <ChevronRight
                      className={cn(
                        'h-3 w-3 flex-shrink-0 text-text-quaternary transition-transform duration-200 dark:text-text-dark-quaternary',
                        isExpanded && 'rotate-90',
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-2xs text-text-tertiary dark:text-text-dark-tertiary">
                          #{pr.number}
                        </span>
                        <span className="truncate text-xs font-medium text-text-primary dark:text-text-dark-primary">
                          {pr.title}
                        </span>
                        {pr.draft && (
                          <span className="rounded border border-border/50 px-1 py-0.5 text-2xs text-text-quaternary dark:border-border-dark/50 dark:text-text-dark-quaternary">
                            Draft
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 text-2xs text-text-quaternary dark:text-text-dark-quaternary">
                        <span>{pr.user.login}</span>
                        <span className="font-mono">
                          {pr.head.ref} → {pr.base.ref}
                        </span>
                        {pr.review_comments > 0 && (
                          <span className="flex items-center gap-0.5">
                            <MessageSquare className="h-2.5 w-2.5" />
                            {pr.review_comments}
                          </span>
                        )}
                      </div>
                    </div>
                    <span
                      role="link"
                      onClick={(e) => {
                        e.stopPropagation();
                        openExternalUrl(pr.html_url);
                      }}
                      className="flex-shrink-0 text-2xs text-text-quaternary underline transition-colors duration-200 hover:text-text-primary dark:text-text-dark-quaternary dark:hover:text-text-dark-primary"
                    >
                      GitHub
                    </span>
                  </Button>

                  {isExpanded && (
                    <div className="border-t border-border/50 px-2.5 pt-2 dark:border-border-dark/50">
                      <PRComments
                        owner={owner}
                        repo={repo}
                        number={pr.number}
                        workspaceId={currentChat?.workspace_id}
                        chatId={currentChat?.id}
                        headRef={pr.head.ref}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
});
