import type { MainFilter, MenuMode } from './commandRegistry';

export const FILTER_LABELS: Record<MainFilter, string> = {
  all: 'All',
  chats: 'Chats',
  files: 'Files',
  actions: 'Actions',
};

export const isMainMode = (mode: MenuMode): mode is MainFilter =>
  mode === 'all' || mode === 'chats' || mode === 'files' || mode === 'actions';
