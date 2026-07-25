import { useCallback } from 'react';
import { matchPath, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { isMobileViewport } from '@/hooks/useIsMobile';
import { useUIStore } from '@/store/uiStore';
import { fetchNotificationsEnabled } from '@/hooks/queries/useSettingsQueries';
import { paintedChatIds, paintedLayout } from '@/utils/tileHelpers';
import { logger } from '@/utils/logger';
import { bumpAppBadge, type NotifyOptions } from '@/utils/notifications';

// Suppress only when the event's chat is painted on screen in a focused window.
// Panes stay mounted while hidden, so mount state can't stand in for visibility.
export function useBackgroundNotify(): (
  targetChatId: string | undefined,
  notify: (options: NotifyOptions) => Promise<boolean>,
) => void {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  return useCallback(
    (targetChatId: string | undefined, notify: (options: NotifyOptions) => Promise<boolean>) => {
      // Read live: stored stream callbacks can invoke this closure long after
      // the pane that created it unmounted, freezing anything captured at render.
      const pathname = window.location.pathname;
      const routeChatId = matchPath('/chat/:chatId', pathname)?.params.chatId;
      // Only the workspace routes mount tiles — elsewhere (settings, auth) the
      // persisted layout paints nothing, so it can't suppress anything.
      const paintsTiles = Boolean(routeChatId || matchPath('/', pathname));
      if (paintsTiles && targetChatId && document.hasFocus()) {
        const { visibleLayout, focusedTile, splitChatIds } = useUIStore.getState();
        const painted = paintedChatIds(
          paintedLayout(visibleLayout, focusedTile, isMobileViewport()).flat(),
          splitChatIds,
          routeChatId,
        );
        if (painted.has(targetChatId)) return;
      }

      void (async () => {
        if (!(await fetchNotificationsEnabled(queryClient))) return;
        const delivered = await notify({
          onClick: targetChatId ? () => navigate(`/chat/${targetChatId}`) : undefined,
        });
        // Focus is re-read: the user can return during the awaits above, after
        // useAppBadge's clear already ran on a zero count.
        if (delivered && !document.hasFocus()) await bumpAppBadge();
      })().catch((error) => logger.warn('Background notify failed', 'notifications', error));
    },
    [navigate, queryClient],
  );
}
