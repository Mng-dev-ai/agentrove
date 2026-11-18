import type { CursorPaginatedResponse } from './api.types';

export interface InboxItem {
  id: string;
  chat_id: string;
  title: string;
  body: string;
  read_at: string | null;
  created_at: string;
  chat_title?: string;
  workspace_name?: string;
}

export interface InboxList extends CursorPaginatedResponse<InboxItem> {
  unread_count: number;
}
