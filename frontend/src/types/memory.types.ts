export interface Memory {
  id: string;
  workspace_id: string | null;
  title: string;
  content: string;
  pinned: boolean;
  source_chat_id: string | null;
  source_model_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface MemoryCreateRequest {
  title: string;
  content: string;
  pinned: boolean;
  workspace_id: string | null;
}

export type MemoryUpdateRequest = Partial<MemoryCreateRequest>;
