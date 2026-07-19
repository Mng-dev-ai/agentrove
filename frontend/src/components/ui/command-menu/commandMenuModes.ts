import { MAIN_FILTERS, type MainFilter, type MenuMode } from './commandRegistry';

export const FILTER_LABELS: Record<MainFilter, string> = {
  all: 'All',
  chats: 'Chats',
  messages: 'Messages',
  files: 'Files',
  grep: 'Grep',
  actions: 'Actions',
};

export const isMainMode = (mode: MenuMode): mode is MainFilter =>
  (MAIN_FILTERS as MenuMode[]).includes(mode);

// Panel filters swap the list for an embedded search panel with its own input.
export const isPanelMode = (mode: MenuMode): mode is 'messages' | 'grep' =>
  mode === 'messages' || mode === 'grep';
