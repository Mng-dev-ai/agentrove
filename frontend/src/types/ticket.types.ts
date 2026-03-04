export type TicketType = 'admin' | 'manager' | 'department' | 'general';
export type TicketPriority = 'low' | 'medium' | 'high' | 'urgent' | 'critical';
export type TicketStatus = 'open' | 'in_progress' | 'waiting' | 'resolved' | 'closed';

export interface TicketCategory {
  id: string;
  name: string;
  description: string | null;
  ticket_type: TicketType;
  department_id: string | null;
  is_active: boolean;
  sort_order: number;
  created_at: string;
}

export interface TicketCategoryCreate {
  name: string;
  description?: string | null;
  ticket_type: TicketType;
  department_id?: string | null;
  sort_order?: number;
}

export interface TicketCategoryUpdate {
  name?: string;
  description?: string | null;
  ticket_type?: TicketType;
  department_id?: string | null;
  is_active?: boolean;
  sort_order?: number;
}

export interface Ticket {
  id: string;
  ticket_number: number;
  title: string;
  description: string;
  ticket_type: TicketType;
  priority: TicketPriority;
  status: TicketStatus;
  category_id: string | null;
  department_id: string | null;
  project_id: string | null;
  team_id: string | null;
  requester_id: string;
  assignee_id: string | null;
  due_date: string | null;
  is_private: boolean;
  resolved_at: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TicketWithDetails extends Ticket {
  requester_name: string;
  requester_email: string;
  assignee_name: string | null;
  assignee_email: string | null;
  category_name: string | null;
  department_name: string | null;
  team_name: string | null;
  comments_count: number;
}

export interface TicketCreate {
  title: string;
  description: string;
  ticket_type: TicketType;
  priority: TicketPriority;
  category_id?: string | null;
  department_id?: string | null;
  project_id?: string | null;
  team_id?: string | null;
  due_date?: string | null;
  is_private?: boolean;
}

export interface TicketUpdate {
  title?: string;
  description?: string;
  ticket_type?: TicketType;
  priority?: TicketPriority;
  status?: TicketStatus;
  category_id?: string | null;
  department_id?: string | null;
  project_id?: string | null;
  assignee_id?: string | null;
  team_id?: string | null;
  due_date?: string | null;
  is_private?: boolean;
}

export interface TicketComment {
  id: string;
  ticket_id: string;
  author_id: string;
  content: string;
  is_internal: boolean;
  created_at: string;
  updated_at: string;
}

export interface TicketCommentWithAuthor extends TicketComment {
  author_name: string;
  author_email: string;
}

export interface TicketCommentCreate {
  content: string;
  is_internal?: boolean;
}

export interface TicketListResponse {
  items: Ticket[];
  total: number;
  page: number;
  page_size: number;
  pages: number;
}

export interface TicketFilters {
  ticket_type?: TicketType;
  status?: TicketStatus;
  priority?: TicketPriority;
  category_id?: string;
  department_id?: string;
  assignee_id?: string;
  requester_id?: string;
  team_id?: string;
  is_private?: boolean;
  search?: string;
}

export interface TicketStats {
  total: number;
  by_status: Record<TicketStatus, number>;
  by_priority: Record<TicketPriority, number>;
  by_type: Record<TicketType, number>;
}
