import { apiClient } from '@/lib/api';
import { ensureResponse, withAuth } from '@/services/base/BaseService';
import type {
  Project,
  ProjectWithDetails,
  ProjectCreate,
  ProjectUpdate,
  ProjectMemberWithUser,
  ProjectMemberCreate,
  Task,
  TaskWithDetails,
  TaskCreate,
  TaskUpdate,
  TimeEntry,
  TimeEntryWithUser,
  TimeEntryCreate,
  TimeEntryUpdate,
  AICostEntry,
  AICostEntryCreate,
  ProjectStats,
  TimeStats,
  AICostStats,
  ProjectListResponse,
  TimeEntryListResponse,
  AICostListResponse,
  ProjectStatus,
  TaskStatus,
} from '@/types/project.types';

// Projects
async function getProjects(
  status?: ProjectStatus,
  page: number = 1,
  pageSize: number = 20
): Promise<ProjectListResponse> {
  return withAuth(async () => {
    const params = new URLSearchParams();
    if (status) params.append('status', status);
    params.append('page', String(page));
    params.append('page_size', String(pageSize));
    const response = await apiClient.get<ProjectListResponse>(`/projects?${params.toString()}`);
    return ensureResponse(response, 'Invalid response from server');
  });
}

async function getProject(projectId: string): Promise<ProjectWithDetails> {
  return withAuth(async () => {
    const response = await apiClient.get<ProjectWithDetails>(`/projects/${projectId}`);
    return ensureResponse(response, 'Invalid response from server');
  });
}

async function createProject(data: ProjectCreate): Promise<Project> {
  return withAuth(async () => {
    const response = await apiClient.post<Project>('/projects', data);
    return ensureResponse(response, 'Invalid response from server');
  });
}

async function updateProject(projectId: string, data: ProjectUpdate): Promise<Project> {
  return withAuth(async () => {
    const response = await apiClient.patch<Project>(`/projects/${projectId}`, data);
    return ensureResponse(response, 'Invalid response from server');
  });
}

async function deleteProject(projectId: string): Promise<void> {
  return withAuth(async () => {
    await apiClient.delete(`/projects/${projectId}`);
  });
}

async function getProjectStats(): Promise<ProjectStats> {
  return withAuth(async () => {
    const response = await apiClient.get<ProjectStats>('/projects/stats');
    return ensureResponse(response, 'Invalid response from server');
  });
}

// Project Members
async function getProjectMembers(projectId: string): Promise<ProjectMemberWithUser[]> {
  return withAuth(async () => {
    const response = await apiClient.get<ProjectMemberWithUser[]>(`/projects/${projectId}/members`);
    return ensureResponse(response, 'Invalid response from server');
  });
}

async function addProjectMember(projectId: string, data: ProjectMemberCreate): Promise<void> {
  return withAuth(async () => {
    await apiClient.post(`/projects/${projectId}/members`, data);
  });
}

async function removeProjectMember(projectId: string, userId: string): Promise<void> {
  return withAuth(async () => {
    await apiClient.delete(`/projects/${projectId}/members/${userId}`);
  });
}

// Tasks
async function getProjectTasks(
  projectId: string,
  status?: TaskStatus,
  assigneeId?: string
): Promise<TaskWithDetails[]> {
  return withAuth(async () => {
    const params = new URLSearchParams();
    if (status) params.append('status', status);
    if (assigneeId) params.append('assignee_id', assigneeId);
    const query = params.toString() ? `?${params.toString()}` : '';
    const response = await apiClient.get<TaskWithDetails[]>(`/projects/${projectId}/tasks${query}`);
    return ensureResponse(response, 'Invalid response from server');
  });
}

async function createTask(projectId: string, data: TaskCreate): Promise<Task> {
  return withAuth(async () => {
    const response = await apiClient.post<Task>(`/projects/${projectId}/tasks`, data);
    return ensureResponse(response, 'Invalid response from server');
  });
}

async function updateTask(taskId: string, data: TaskUpdate): Promise<Task> {
  return withAuth(async () => {
    const response = await apiClient.patch<Task>(`/projects/tasks/${taskId}`, data);
    return ensureResponse(response, 'Invalid response from server');
  });
}

async function deleteTask(taskId: string): Promise<void> {
  return withAuth(async () => {
    await apiClient.delete(`/projects/tasks/${taskId}`);
  });
}

// Time Entries
async function getTimeEntries(
  projectId?: string,
  page: number = 1,
  pageSize: number = 20
): Promise<TimeEntryListResponse> {
  return withAuth(async () => {
    const params = new URLSearchParams();
    if (projectId) params.append('project_id', projectId);
    params.append('page', String(page));
    params.append('page_size', String(pageSize));
    const response = await apiClient.get<TimeEntryListResponse>(`/projects/time-entries?${params.toString()}`);
    return ensureResponse(response, 'Invalid response from server');
  });
}

async function createTimeEntry(data: TimeEntryCreate): Promise<TimeEntry> {
  return withAuth(async () => {
    const response = await apiClient.post<TimeEntry>('/projects/time-entries', data);
    return ensureResponse(response, 'Invalid response from server');
  });
}

async function updateTimeEntry(entryId: string, data: TimeEntryUpdate): Promise<TimeEntry> {
  return withAuth(async () => {
    const response = await apiClient.patch<TimeEntry>(`/projects/time-entries/${entryId}`, data);
    return ensureResponse(response, 'Invalid response from server');
  });
}

async function approveTimeEntry(entryId: string): Promise<TimeEntry> {
  return withAuth(async () => {
    const response = await apiClient.post<TimeEntry>(`/projects/time-entries/${entryId}/approve`);
    return ensureResponse(response, 'Invalid response from server');
  });
}

async function deleteTimeEntry(entryId: string): Promise<void> {
  return withAuth(async () => {
    await apiClient.delete(`/projects/time-entries/${entryId}`);
  });
}

async function getTimeStats(): Promise<TimeStats> {
  return withAuth(async () => {
    const response = await apiClient.get<TimeStats>('/projects/time-stats');
    return ensureResponse(response, 'Invalid response from server');
  });
}

// AI Costs
async function getAICosts(
  projectId?: string,
  page: number = 1,
  pageSize: number = 20
): Promise<AICostListResponse> {
  return withAuth(async () => {
    const params = new URLSearchParams();
    if (projectId) params.append('project_id', projectId);
    params.append('page', String(page));
    params.append('page_size', String(pageSize));
    const response = await apiClient.get<AICostListResponse>(`/projects/ai-costs?${params.toString()}`);
    return ensureResponse(response, 'Invalid response from server');
  });
}

async function createAICost(data: AICostEntryCreate): Promise<AICostEntry> {
  return withAuth(async () => {
    const response = await apiClient.post<AICostEntry>('/projects/ai-costs', data);
    return ensureResponse(response, 'Invalid response from server');
  });
}

async function getAICostStats(): Promise<AICostStats> {
  return withAuth(async () => {
    const response = await apiClient.get<AICostStats>('/projects/ai-cost-stats');
    return ensureResponse(response, 'Invalid response from server');
  });
}

export const projectService = {
  getProjects,
  getProject,
  createProject,
  updateProject,
  deleteProject,
  getProjectStats,
  getProjectMembers,
  addProjectMember,
  removeProjectMember,
  getProjectTasks,
  createTask,
  updateTask,
  deleteTask,
  getTimeEntries,
  createTimeEntry,
  updateTimeEntry,
  approveTimeEntry,
  deleteTimeEntry,
  getTimeStats,
  getAICosts,
  createAICost,
  getAICostStats,
};
