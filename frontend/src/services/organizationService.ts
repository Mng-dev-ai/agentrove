import { apiClient } from '@/lib/api';
import { ensureResponse, withAuth } from '@/services/base/BaseService';

// Department types
export interface Department {
  id: string;
  name: string;
  description: string | null;
  parent_id: string | null;
  manager_id: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface DepartmentWithChildren extends Department {
  children: DepartmentWithChildren[];
  teams_count: number;
}

export interface DepartmentCreate {
  name: string;
  description?: string | null;
  parent_id?: string | null;
  manager_id?: string | null;
}

export interface DepartmentUpdate {
  name?: string;
  description?: string | null;
  parent_id?: string | null;
  manager_id?: string | null;
  is_active?: boolean;
}

// Team types
export interface Team {
  id: string;
  name: string;
  description: string | null;
  department_id: string | null;
  lead_id: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface TeamWithMembers extends Team {
  members: TeamMemberWithUser[];
  department_name: string | null;
}

export interface TeamCreate {
  name: string;
  description?: string | null;
  department_id?: string | null;
  lead_id?: string | null;
}

export interface TeamUpdate {
  name?: string;
  description?: string | null;
  department_id?: string | null;
  lead_id?: string | null;
  is_active?: boolean;
}

// Team Member types
export interface TeamMember {
  id: string;
  team_id: string;
  user_id: string;
  role: string;
  joined_at: string;
}

export interface TeamMemberWithUser extends TeamMember {
  user_email: string;
  user_name: string;
  user_display_name: string | null;
}

export interface TeamMemberCreate {
  user_id: string;
  role?: string;
}

export interface TeamMemberUpdate {
  role?: string;
}

// Departments
async function getDepartments(): Promise<Department[]> {
  return withAuth(async () => {
    const response = await apiClient.get<Department[]>('/organization/departments');
    return ensureResponse(response, 'Invalid response from server');
  });
}

async function getDepartmentTree(): Promise<DepartmentWithChildren[]> {
  return withAuth(async () => {
    const response = await apiClient.get<DepartmentWithChildren[]>('/organization/departments/tree');
    return ensureResponse(response, 'Invalid response from server');
  });
}

async function createDepartment(data: DepartmentCreate): Promise<Department> {
  return withAuth(async () => {
    const response = await apiClient.post<Department>('/organization/departments', data);
    return ensureResponse(response, 'Invalid response from server');
  });
}

async function updateDepartment(departmentId: string, data: DepartmentUpdate): Promise<Department> {
  return withAuth(async () => {
    const response = await apiClient.patch<Department>(`/organization/departments/${departmentId}`, data);
    return ensureResponse(response, 'Invalid response from server');
  });
}

async function deleteDepartment(departmentId: string): Promise<void> {
  return withAuth(async () => {
    await apiClient.delete(`/organization/departments/${departmentId}`);
  });
}

// Teams
async function getTeams(departmentId?: string): Promise<TeamWithMembers[]> {
  return withAuth(async () => {
    const query = departmentId ? `?department_id=${departmentId}` : '';
    const response = await apiClient.get<TeamWithMembers[]>(`/organization/teams${query}`);
    return ensureResponse(response, 'Invalid response from server');
  });
}

async function getTeam(teamId: string): Promise<TeamWithMembers> {
  return withAuth(async () => {
    const response = await apiClient.get<TeamWithMembers>(`/organization/teams/${teamId}`);
    return ensureResponse(response, 'Invalid response from server');
  });
}

async function createTeam(data: TeamCreate): Promise<Team> {
  return withAuth(async () => {
    const response = await apiClient.post<Team>('/organization/teams', data);
    return ensureResponse(response, 'Invalid response from server');
  });
}

async function updateTeam(teamId: string, data: TeamUpdate): Promise<Team> {
  return withAuth(async () => {
    const response = await apiClient.patch<Team>(`/organization/teams/${teamId}`, data);
    return ensureResponse(response, 'Invalid response from server');
  });
}

async function deleteTeam(teamId: string): Promise<void> {
  return withAuth(async () => {
    await apiClient.delete(`/organization/teams/${teamId}`);
  });
}

// Team Members
async function addTeamMember(teamId: string, data: TeamMemberCreate): Promise<TeamMember> {
  return withAuth(async () => {
    const response = await apiClient.post<TeamMember>(`/organization/teams/${teamId}/members`, data);
    return ensureResponse(response, 'Invalid response from server');
  });
}

async function removeTeamMember(teamId: string, userId: string): Promise<void> {
  return withAuth(async () => {
    await apiClient.delete(`/organization/teams/${teamId}/members/${userId}`);
  });
}

async function getUserTeams(userId: string): Promise<Team[]> {
  return withAuth(async () => {
    const response = await apiClient.get<Team[]>(`/organization/users/${userId}/teams`);
    return ensureResponse(response, 'Invalid response from server');
  });
}

export const organizationService = {
  getDepartments,
  getDepartmentTree,
  createDepartment,
  updateDepartment,
  deleteDepartment,
  getTeams,
  getTeam,
  createTeam,
  updateTeam,
  deleteTeam,
  addTeamMember,
  removeTeamMember,
  getUserTeams,
};
