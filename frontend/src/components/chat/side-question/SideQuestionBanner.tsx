import { useMemo } from 'react';
import { MessageCircleQuestion } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button/Button';
import { useSubThreadsQuery } from '@/hooks/queries/useChatQueries';
import { useModelMap } from '@/hooks/queries/useModelQueries';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useChatMachineId } from '@/store/machineOrigin';
import { useStreamStore } from '@/store/streamStore';
import { useUIStore } from '@/store/uiStore';
import type { Chat } from '@/types/chat.types';
import { paintedChatIds, paintedLayout } from '@/utils/tileHelpers';
import { sideQuestionIntent } from '@/utils/sideQuestion';
import queue from '@/components/chat/chat-window/ChatQueueBanner.module.scss';
import styles from './SideQuestion.module.scss';

interface SideQuestionBannerProps {
  chat: Chat;
  message: string;
  isStreaming: boolean;
}

export function SideQuestionBanner({ chat, message, isStreaming }: SideQuestionBannerProps) {
  const chatId = chat.id;
  const isMobile = useIsMobile();
  const chatModel = useModelMap({ machineId: useChatMachineId(chatId) }).get(
    chat.last_model_id ?? '',
  );
  const { data: subThreads } = useSubThreadsQuery(chatId);
  const visibleLayout = useUIStore((s) => s.visibleLayout);
  const focusedTile = useUIStore((s) => s.focusedTile);
  const splitChatIds = useUIStore((s) => s.splitChatIds);
  const activeStreamMetadata = useStreamStore((s) => s.activeStreamMetadata);

  const closed = useMemo(() => {
    const painted = paintedChatIds(
      paintedLayout(visibleLayout, focusedTile, isMobile).flat(),
      splitChatIds,
      chatId,
    );
    return (subThreads ?? []).filter(
      (thread) => thread.is_side_question && !painted.has(thread.id),
    );
  }, [subThreads, visibleLayout, focusedTile, isMobile, splitChatIds, chatId]);

  const intent = sideQuestionIntent(message, chat, chatModel);

  if (intent?.kind === 'ask') {
    return (
      <SideQuestionNotice
        text={
          isStreaming
            ? 'Answers in a side pane. This turn keeps running.'
            : 'Answers in a side pane.'
        }
      />
    );
  }
  if (closed.length === 0) return null;

  const working = closed.some((thread) =>
    activeStreamMetadata.some((stream) => stream.chatId === thread.id),
  );
  return (
    <SideQuestionNotice
      text={closed.length === 1 ? '1 side question' : `${closed.length} side questions`}
      status={working ? 'Working' : undefined}
      onOpen={() => useUIStore.getState().openSideQuestion(closed[0].id)}
    />
  );
}

interface SideQuestionNoticeProps {
  text: string;
  status?: string;
  onOpen?: () => void;
}

function SideQuestionNotice({ text, status, onOpen }: SideQuestionNoticeProps) {
  return (
    <div className={queue['queue-banner']}>
      <div className={queue['queue-card-list']}>
        <div className={styles.notice}>
          <MessageCircleQuestion className={styles['notice-icon']} />
          <span className={styles['notice-text']}>{text}</span>
          {status && <span className={styles['notice-status']}>{status}</span>}
          {onOpen && (
            <Button
              variant="unstyled"
              type="button"
              className={styles['notice-action']}
              onClick={onOpen}
            >
              Open
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
