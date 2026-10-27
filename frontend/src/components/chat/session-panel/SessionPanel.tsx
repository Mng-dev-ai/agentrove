import { memo, useEffect, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Cloud,
  CornerLeftUp,
  ExternalLink,
  Folder,
  GitBranch,
  Monitor,
  Plus,
} from 'lucide-react';
import clsx from 'clsx';
import { Button } from '@/components/ui/primitives/Button/Button';
import { FloatingTooltip } from '@/components/ui/FloatingTooltip/FloatingTooltip';
import { AsciiSpinner } from '@/components/ui/AsciiSpinner/AsciiSpinner';
import { ChatStatusDot } from '@/components/ui/ChatStatusDot/ChatStatusDot';
import { ProviderIcon } from '@/components/ui/icons/ProviderIcon';
import { AGENTS_WITHOUT_USAGE_UPDATE } from '@/config/constants';
import { useChatQuery, useSubThreadsQuery } from '@/hooks/queries/useChatQueries';
import { useModelMap } from '@/hooks/queries/useModelQueries';
import {
  useGitBranchesQuery,
  useGitDiffStatsQuery,
  useGitFetchBaseMutation,
} from '@/hooks/queries/useSandboxQueries';
import { useBranchPullRequests } from '@/hooks/queries/useGitHubQueries';
import { useBlockedChatIds } from '@/hooks/useBlockedChatIds';
import { useChatAgentKind } from '@/hooks/useChatAgentKind';
import { useChatSessionState } from '@/hooks/useChatSessionContext';
import { useStreamStore } from '@/store/streamStore';
import { useUIStore } from '@/store/uiStore';
import { getAgentKindForModelId, type Chat } from '@/types/chat.types';
import type { Channel } from '@/types/channel.types';
import type { DiffMode, GitDiffTotals } from '@/types/sandbox.types';
import type { Workspace } from '@/types/workspace.types';
import { useIsCloudChat } from '@/utils/chatOrigin';
import { getRelativeTime } from '@/utils/date';
import { getContextUsageDisplay } from '@/utils/contextUsage';
import { stripMarkdownTitle } from '@/utils/format';
import { chatStatusTone } from '@/utils/message';
import { openExternalUrl } from '@/utils/openExternal';
import styles from './SessionPanel.module.scss';

// Dialogs and view toggles act on the focused pane; the panel describes the
// routed chat, so point them at the primary pane first.
function focusPrimaryAgent() {
  useUIStore.getState().focusTile('agent:primary');
}

function Card({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className={styles.card}>
      <header className={styles['card-header']}>
        <h3 className={styles['card-title']}>{title}</h3>
        {action}
      </header>
      {children}
    </section>
  );
}

function Row({ icon, children, hint }: { icon: ReactNode; children: ReactNode; hint?: string }) {
  return (
    <div className={styles.row}>
      <span className={styles['row-icon']}>{icon}</span>
      {hint ? (
        <FloatingTooltip content={hint} className={styles['row-text']}>
          {children}
        </FloatingTooltip>
      ) : (
        <span className={styles['row-text']}>{children}</span>
      )}
    </div>
  );
}

function ModelRow({ chat }: { chat: Chat }) {
  const { selectedModelId } = useChatSessionState();
  const modelMap = useModelMap();
  const agentKind = useChatAgentKind(chat.id, chat.session_agent_kind, chat.last_model_id);
  const model = modelMap.get(selectedModelId);
  if (!selectedModelId) return null;
  return (
    <Row icon={agentKind ? <ProviderIcon agentKind={agentKind} className={styles.glyph} /> : null}>
      {model?.name ?? selectedModelId}
    </Row>
  );
}

function EnvironmentCard({
  chat,
  workspace,
  branch,
  children,
}: {
  chat: Chat;
  workspace: Workspace | undefined;
  branch: string | null;
  children?: ReactNode;
}) {
  const isCloud = useIsCloudChat(chat.id);
  const isDocker = workspace?.sandbox_provider === 'docker';
  const path = chat.worktree_cwd ?? workspace?.workspace_path;
  return (
    <Card title="Environment">
      <Row
        icon={isCloud ? <Cloud className={styles.glyph} /> : <Monitor className={styles.glyph} />}
      >
        {isCloud ? 'Cloud' : 'This computer'}
        {workspace && (
          <span className={styles.secondary}>
            {' · '}
            {isDocker ? 'Docker' : 'Host'}
          </span>
        )}
      </Row>
      {workspace && (
        <Row
          icon={isDocker ? <Box className={styles.glyph} /> : <Folder className={styles.glyph} />}
          hint={path}
        >
          {workspace.name}
          {path && <span className={styles.secondary}>{` · ${path}`}</span>}
        </Row>
      )}
      {branch && (
        <Row icon={<GitBranch className={styles.glyph} />} hint={branch}>
          {branch}
        </Row>
      )}
      {children}
    </Card>
  );
}

function MembersCard({ channel }: { channel: Channel }) {
  const modelMap = useModelMap();
  return (
    <Card title="Members">
      {channel.members.map((member) => {
        const details = [
          modelMap.get(member.model_id)?.name ?? member.model_id,
          member.persona,
          member.thinking_mode,
        ]
          .filter(Boolean)
          .join(' · ');
        return (
          <Row
            key={member.id}
            icon={
              <ProviderIcon
                agentKind={getAgentKindForModelId(member.model_id)}
                className={styles.glyph}
              />
            }
            hint={details}
          >
            {member.display_name}
            <span className={styles.secondary}>{` · ${details}`}</span>
          </Row>
        );
      })}
    </Card>
  );
}

function ContextCard({ chat }: { chat: Chat }) {
  const { contextUsage, selectedModelId } = useChatSessionState();
  const modelMap = useModelMap();
  const agentKind =
    modelMap.get(selectedModelId)?.agent_kind ?? getAgentKindForModelId(selectedModelId);
  if (!contextUsage || AGENTS_WITHOUT_USAGE_UPDATE.has(agentKind)) return null;
  const { percentage, tone, label, tooltip } = getContextUsageDisplay(contextUsage);
  return (
    <Card
      title="Context"
      action={
        <FloatingTooltip content={tooltip} className={styles['context-value']}>
          {label}
        </FloatingTooltip>
      }
    >
      <div
        className={styles['context-track']}
        role="progressbar"
        aria-label={`Context used in ${chat.title}`}
        aria-valuenow={Math.round(percentage)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className={clsx(styles['context-fill'], styles[`context-fill--${tone}`])}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </Card>
  );
}

function SubThreadRow({ thread, onSelect }: { thread: Chat; onSelect: (chatId: string) => void }) {
  const agentKind = useChatAgentKind(thread.id, thread.session_agent_kind, thread.last_model_id);
  const isStreaming = useStreamStore((s) =>
    s.activeStreamMetadata.some((meta) => meta.chatId === thread.id),
  );
  const isCompleted = useStreamStore((s) => s.completedChatIds.has(thread.id));
  const isBlocked = useBlockedChatIds().has(thread.id);
  const status = chatStatusTone({
    blocked: isBlocked,
    streaming: isStreaming,
    completed: isCompleted,
  });
  return (
    <Button
      variant="unstyled"
      type="button"
      className={styles['thread-row']}
      onClick={() => onSelect(thread.id)}
    >
      <span className={styles['row-icon']}>
        {status === 'running' ? (
          <AsciiSpinner className={styles.spinner} />
        ) : agentKind ? (
          <ProviderIcon agentKind={agentKind} className={styles.glyph} />
        ) : null}
        {status && status !== 'running' && (
          <ChatStatusDot
            tone={status}
            className={clsx(agentKind && styles['status-corner'])}
            ringClassName={styles['status-ring']}
          />
        )}
      </span>
      <span className={styles['row-text']}>{stripMarkdownTitle(thread.title)}</span>
      <span className={styles.timestamp}>{getRelativeTime(thread.updated_at)}</span>
    </Button>
  );
}

function ParentThreadCard({ parentChatId }: { parentChatId: string }) {
  const navigate = useNavigate();
  const { data: parent } = useChatQuery(parentChatId);
  return (
    <Card title="Parent thread">
      <Button
        variant="unstyled"
        type="button"
        className={styles['thread-row']}
        onClick={() => navigate(`/chat/${parentChatId}`)}
      >
        <span className={styles['row-icon']}>
          <CornerLeftUp className={styles.glyph} />
        </span>
        <span className={styles['row-text']}>
          {parent ? stripMarkdownTitle(parent.title) : 'Parent thread'}
        </span>
      </Button>
    </Card>
  );
}

function SubThreadsCard({ chatId }: { chatId: string }) {
  const navigate = useNavigate();
  const { data: subThreads } = useSubThreadsQuery(chatId);
  return (
    <Card
      title="Sub-threads"
      action={
        <FloatingTooltip content="New sub-thread">
          <Button
            variant="unstyled"
            type="button"
            className={styles['header-button']}
            aria-label="New sub-thread"
            onClick={() => {
              focusPrimaryAgent();
              useUIStore.getState().setSubThreadDialogOpen(true);
            }}
          >
            <Plus className={styles.glyph} />
          </Button>
        </FloatingTooltip>
      }
    >
      {subThreads && subThreads.length > 0 ? (
        subThreads.map((thread) => (
          <SubThreadRow
            key={thread.id}
            thread={thread}
            onSelect={(id) => navigate(`/chat/${id}`)}
          />
        ))
      ) : (
        <p className={styles.empty}>No sub-threads yet</p>
      )}
    </Card>
  );
}

function openDiff(chatId: string, mode: DiffMode) {
  focusPrimaryAgent();
  useUIStore.setState({ pendingDiffMode: { chatId, mode } });
  useUIStore.getState().toggleView('diff', false);
}

function ChangesRow({
  label,
  totals,
  onOpen,
  action,
}: {
  label: string;
  totals: GitDiffTotals;
  onOpen: () => void;
  action: ReactNode;
}) {
  return (
    <div className={styles['changes-row']}>
      <Button
        variant="unstyled"
        type="button"
        className={styles['diff-stats']}
        onClick={onOpen}
        aria-label={`Open ${label.toLowerCase()} diff`}
      >
        <span className={styles['changes-label']}>{label}</span>
        <span className={styles['changes-numbers']}>
          {(totals.additions > 0 || totals.deletions > 0) && (
            <>
              <span className={styles['stat-add']}>+{totals.additions}</span>
              <span className={styles['stat-del']}>−{totals.deletions}</span>
            </>
          )}
          <span className={styles.secondary}>
            {totals.files_changed} {totals.files_changed === 1 ? 'file' : 'files'}
          </span>
        </span>
      </Button>
      {action}
    </div>
  );
}

function ChangesCard({
  chatId,
  sandboxId,
  worktreeCwd,
  branch,
}: {
  chatId: string;
  sandboxId: string;
  worktreeCwd: string | undefined;
  branch: string;
}) {
  const { data: stats } = useGitDiffStatsQuery(sandboxId, worktreeCwd);
  const { mutate: fetchBase } = useGitFetchBaseMutation();
  useEffect(() => {
    fetchBase({ sandboxId, cwd: worktreeCwd });
  }, [fetchBase, sandboxId, worktreeCwd]);
  const { openPR, mergedPR } = useBranchPullRequests(sandboxId, worktreeCwd, branch, chatId);
  if (!stats) return null;
  const hasUncommitted = stats.uncommitted.files_changed > 0;
  // A PR only carries committed work, so the PR action belongs to the branch row.
  const mergedAtHead = mergedPR && mergedPR.head.sha === stats.head_sha ? mergedPR : undefined;
  const linkedPR = openPR ?? mergedAtHead;
  const showBranch = stats.branch.files_changed > 0 || !!linkedPR;
  return (
    <Card title="Changes">
      {hasUncommitted && (
        <ChangesRow
          label="Uncommitted"
          totals={stats.uncommitted}
          onOpen={() => openDiff(chatId, 'all')}
          action={
            <Button
              variant="unstyled"
              type="button"
              className={styles['pr-button']}
              onClick={() => {
                focusPrimaryAgent();
                useUIStore.getState().setCreateCommitDialogOpen(true);
              }}
            >
              Commit
            </Button>
          }
        />
      )}
      {showBranch && (
        <ChangesRow
          label="Branch"
          totals={stats.branch}
          onOpen={() => openDiff(chatId, 'branch')}
          action={
            linkedPR ? (
              <Button
                variant="unstyled"
                type="button"
                className={styles['pr-button']}
                onClick={() => openExternalUrl(linkedPR.html_url)}
              >
                PR #{linkedPR.number}
                {!openPR && ' · Merged'}
                <ExternalLink className={styles['pr-icon']} />
              </Button>
            ) : (
              <Button
                variant="unstyled"
                type="button"
                className={styles['pr-button']}
                onClick={() => {
                  focusPrimaryAgent();
                  useUIStore.getState().setCreatePRDialogOpen(true);
                }}
              >
                Create PR
              </Button>
            )
          }
        />
      )}
      {!hasUncommitted && !showBranch && <p className={styles.empty}>No changes</p>}
    </Card>
  );
}

interface SessionPanelProps {
  chat: Chat;
  workspace: Workspace | undefined;
  // A channel's panel describes its shared workspace through `chat`, one of its member chats.
  channel?: Channel;
}

export const SessionPanel = memo(function SessionPanel({
  chat,
  workspace,
  channel,
}: SessionPanelProps) {
  const worktreeCwd = chat.worktree_cwd ?? undefined;
  const { data: branches } = useGitBranchesQuery(chat.sandbox_id, true, worktreeCwd);
  const branch = branches?.is_git_repo ? branches.current_branch : null;
  return (
    <aside className={styles.panel} aria-label="Session details">
      <EnvironmentCard chat={chat} workspace={workspace} branch={branch}>
        {!channel && <ModelRow chat={chat} />}
      </EnvironmentCard>
      {channel ? (
        <MembersCard channel={channel} />
      ) : (
        <>
          <ContextCard chat={chat} />
          {chat.parent_chat_id ? (
            <ParentThreadCard parentChatId={chat.parent_chat_id} />
          ) : (
            <SubThreadsCard chatId={chat.id} />
          )}
        </>
      )}
      {branch && (
        <ChangesCard
          chatId={chat.id}
          sandboxId={chat.sandbox_id}
          worktreeCwd={worktreeCwd}
          branch={branch}
        />
      )}
    </aside>
  );
});
