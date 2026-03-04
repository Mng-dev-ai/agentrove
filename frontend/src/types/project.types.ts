export type ProjectStatus = 'planning' | 'active' | 'on_hold' | 'completed' | 'archived';
export type ProjectPriority = 'low' | 'medium' | 'high' | 'critical';
export type TaskStatus = 'todo' | 'in_progress' | 'in_review' | 'done' | 'cancelled';
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';

// Project
export interface Project {
  id: string;
  name: string;
  key: string;
  description: string | null;
  status: ProjectStatus;
  priority: ProjectPriority;
  customer_id: string | null;
  department_id: string | null;
  team_id: string | null;
  owner_id: string;
  budget: number | null;
  hourly_rate: number | null;
  start_date: string | null;
  due_date: string | null;
  is_billable: boolean;
  is_private: boolean;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectWithDetails extends Project {
  owner_name: string;
  owner_email: string;
  customer_name: string | null;
  department_name: string | null;
  team_name: string | null;
  members_count: number;
  tasks_count: number;
  completed_tasks: number;
  total_hours: number;
}

export interface ProjectCreate {
  name: string;
  key: string;
  description?: string | null;
  status?: ProjectStatus;
  priority?: ProjectPriority;
  customer_id?: string | null;
  department_id?: string | null;
  team_id?: string | null;
  budget?: number | null;
  hourly_rate?: number | null;
  start_date?: string | null;
  due_date?: string | null;
  is_billable?: boolean;
  is_private?: boolean;
}

export interface ProjectUpdate {
  name?: string;
  key?: string;
  description?: string | null;
  status?: ProjectStatus;
  priority?: ProjectPriority;
  customer_id?: string | null;
  department_id?: string | null;
  team_id?: string | null;
  owner_id?: string | null;
  budget?: number | null;
  hourly_rate?: number | null;
  start_date?: string | null;
  due_date?: string | null;
  is_billable?: boolean;
  is_private?: boolean;
}

// Project Member
export interface ProjectMember {
  id: string;
  project_id: string;
  user_id: string;
  role: string;
  hourly_rate: number | null;
  joined_at: string;
}

export interface ProjectMemberWithUser extends ProjectMember {
  user_name: string;
  user_email: string;
  user_display_name: string | null;
}

export interface ProjectMemberCreate {
  user_id: string;
  role?: string;
  hourly_rate?: number | null;
}

// Task
export interface Task {
  id: string;
  project_id: string;
  parent_task_id: string | null;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  assignee_id: string | null;
  reporter_id: string;
  estimated_hours: number | null;
  actual_hours: number | null;
  due_date: string | null;
  completed_at: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface TaskWithDetails extends Task {
  project_name: string;
  assignee_name: string | null;
  assignee_email: string | null;
  reporter_name: string;
  reporter_email: string;
  subtasks_count: number;
  time_entries_count: number;
  total_hours: number;
}

export interface TaskCreate {
  project_id: string;
  parent_task_id?: string | null;
  title: string;
  description?: string | null;
  status?: TaskStatus;
  priority?: TaskPriority;
  assignee_id?: string | null;
  estimated_hours?: number | null;
  due_date?: string | null;
}

export interface TaskUpdate {
  title?: string;
  description?: string | null;
  status?: TaskStatus;
  priority?: TaskPriority;
  assignee_id?: string | null;
  estimated_hours?: number | null;
  actual_hours?: number | null;
  due_date?: string | null;
  sort_order?: number;
}

// Time Entry
export interface TimeEntry {
  id: string;
  project_id: string;
  task_id: string | null;
  user_id: string;
  description: string | null;
  start_time: string;
  end_time: string | null;
  duration_minutes: number;
  is_billable: boolean;
  is_approved: boolean;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
}

export interface TimeEntryWithUser extends TimeEntry {
  user_name: string;
  user_email: string;
  project_name: string;
  task_title: string | null;
}

export interface TimeEntryCreate {
  project_id: string;
  task_id?: string | null;
  description?: string | null;
  start_time: string;
  end_time?: string | null;
  duration_minutes?: number;
  is_billable?: boolean;
}

export interface TimeEntryUpdate {
  task_id?: string | null;
  description?: string | null;
  start_time?: string;
  end_time?: string | null;
  duration_minutes?: number;
  is_billable?: boolean;
}

// AI Cost Entry
export interface AICostEntry {
  id: string;
  project_id: string | null;
  task_id: string | null;
  user_id: string;
  provider: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  chat_id: string | null;
  created_at: string;
}

export interface AICostEntryCreate {
  project_id?: string | null;
  task_id?: string | null;
  provider: string;
  model: string;
  input_tokens?: number;
  output_tokens?: number;
  cost_usd?: number;
  chat_id?: string | null;
}

// Statistics
export interface ProjectStats {
  total_projects: number;
  active_projects: number;
  completed_projects: number;
  total_tasks: number;
  completed_tasks: number;
  total_hours: number;
  total_ai_cost: number;
}

export interface TimeStats {
  total_hours: number;
  billable_hours: number;
  non_billable_hours: number;
  by_user: Record<string, number>;
  by_project: Record<string, number>;
}

export interface AICostStats {
  total_cost: number;
  total_input_tokens: number;
  total_output_tokens: number;
  by_provider: Record<string, number>;
  by_model: Record<string, number>;
  by_user: Record<string, number>;
}

// List responses
export interface ProjectListResponse {
  items: Project[];
  total: number;
  page: number;
  page_size: number;
  pages: number;
}

export interface TimeEntryListResponse {
  items: TimeEntryWithUser[];
  total: number;
  page: number;
  page_size: number;
  pages: number;
}

export interface AICostListResponse {
  items: AICostEntry[];
  total: number;
  page: number;
  page_size: number;
  pages: number;
}
