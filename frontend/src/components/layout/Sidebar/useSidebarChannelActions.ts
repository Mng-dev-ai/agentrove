import { useCallback, useEffect, useMemo, type MouseEvent, type RefObject } from 'react';
import type { NavigateFunction } from 'react-router-dom';
import { permissionNotifyEvent, useBackgroundNotify } from '@/hooks/useBackgroundNotify';
import { useMountEffect } from '@/hooks/useMountEffect';
import { getMachineClient } from '@/lib/api';
import { streamService } from '@/services/streamService';
import { streamConnection } from '@/services/streamConnection';
import { useChannelStore } from '@/store/channelStore';
import { useMachineStore } from '@/store/machineStore';
import { useUIStore } from '@/store/uiStore';
import type { Channel } from '@/types/channel.types';
import { LOCAL_MACHINE_ID } from '@/types/machine.types';
import { notifyPermissionRequest, notifyStreamComplete } from '@/utils/notifications';
import { calculateDropdownPosition } from './sidebarHelpers';
import type { MachineChannel } from './sidebarGrouping';

interface UseSidebarChannelActionsParams {
  machineChannels: MachineChannel[];
  selectedChannelId: string | null;
  isMobile: boolean;
  navigate: NavigateFunction;
  scrollContainerRef: RefObject<HTMLDivElement | null>;
}

// Channel rows render in the Channels section, under parent chats and in the activity
// list, so the channel feed and menu handling live with the sidebar, not one section.
export function useSidebarChannelActions({
  machineChannels,
  selectedChannelId,
  isMobile,
  navigate,
  scrollContainerRef,
}: UseSidebarChannelActionsParams) {
  const completedChannelIds = useChannelStore((state) => state.completedChannelIds);
  const connections = useMachineStore((state) => state.connections);
  const notifyBackground = useBackgroundNotify();
  const openMenuChannelId = useUIStore((state) =>
    state.channelMenu?.source === 'sidebar' ? state.channelMenu.channel.id : null,
  );
  const liveMachineIdsKey = [...new Set(machineChannels.map(({ machineId }) => machineId))]
    .filter((id) => id === LOCAL_MACHINE_ID || connections[id]?.status === 'online')
    .join('\n');

  useEffect(() => {
    if (selectedChannelId && completedChannelIds.has(selectedChannelId)) {
      useChannelStore.getState().clearCompleted(selectedChannelId);
    }
  }, [selectedChannelId, completedChannelIds]);

  useEffect(
    () =>
      streamService.onChannelNotice((notice) =>
        notifyBackground(
          `/channels/${notice.channelId}`,
          notice.kind === 'channel_permission_request'
            ? permissionNotifyEvent(notice.payload.request.tool_name)
            : notice.kind === 'channel_asked'
              ? 'notify_questions'
              : 'notify_completions',
          (options) =>
            notice.kind === 'channel_permission_request'
              ? notifyPermissionRequest(notice.payload.request, options)
              : notifyStreamComplete({
                  ...options,
                  title: notice.payload.title,
                  message: notice.payload.body,
                }),
        ),
      ),
    [notifyBackground],
  );

  useEffect(() => {
    if (!liveMachineIdsKey) return;
    const releases = liveMachineIdsKey
      .split('\n')
      .map((machineId) => streamConnection.retain(getMachineClient(machineId)));
    return () => releases.forEach((release) => release());
  }, [liveMachineIdsKey]);

  // The menu is fixed-positioned, so it would float at a stale spot once the list scrolls
  useMountEffect(() => {
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer) return;
    const handleScroll = () => {
      const ui = useUIStore.getState();
      if (ui.channelMenu?.source === 'sidebar') ui.setChannelMenu(null);
    };
    scrollContainer.addEventListener('scroll', handleScroll, { passive: true });
    return () => scrollContainer.removeEventListener('scroll', handleScroll);
  });

  const handleChannelSelect = useCallback(
    (channelId: string) => {
      navigate(`/channels/${channelId}`);
      if (isMobile) useUIStore.getState().setSidebarOpen(false);
    },
    [navigate, isMobile],
  );

  const handleChannelDropdownClick = useCallback(
    (e: MouseEvent<HTMLButtonElement>, channel: Channel) => {
      e.stopPropagation();
      const rect = e.currentTarget.getBoundingClientRect();
      useUIStore.getState().toggleChannelMenu({
        channel,
        position: calculateDropdownPosition(rect),
        source: 'sidebar',
      });
    },
    [],
  );

  // Stable while nothing changes, so memoized child lists that take it don't re-render
  return useMemo(
    () => ({
      completedChannelIds,
      openMenuChannelId,
      handleChannelSelect,
      handleChannelDropdownClick,
    }),
    [completedChannelIds, openMenuChannelId, handleChannelSelect, handleChannelDropdownClick],
  );
}

export type SidebarChannelActions = ReturnType<typeof useSidebarChannelActions>;
