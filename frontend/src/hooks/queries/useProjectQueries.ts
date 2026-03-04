import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { projectService } from '@/services/projectService';
import type {
  ProjectCreate,
  ProjectUpdate,
  ProjectMemberCreate,
  TaskCreate,
  TaskUpdate,
  TimeEntryCreate,
  TimeEntryUpdate,
  AICostEntryCreate,
  ProjectStatus,
  TaskStatus,
} from '@/types/project.types';

// Projects
export function useProjectsQuery(status?: ProjectStatus, page: number = 1, pageSize: number = 20) {
  return useQuery({
    queryKey: ['projects', status, page, pageSize],
    queryFn: () => projectService.getProjects(status, page, pageSize),
  });
}

export function useProjectQuery(projectId: string) {
  return useQuery({
    queryKey: ['projects', projectId],
    queryFn: () => projectService.getProject(projectId),
    enabled: !!projectId,
  });
}

export function useProjectStatsQuery() {
  return useQuery({
    queryKey: ['projects', 'stats'],
    queryFn: () => projectService.getProjectStats(),
  });
}

export function useCreateProjectMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: ProjectCreate) => projectService.createProject(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
    },
  });
}

export function useUpdateProjectMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, data }: { projectId: string; data: ProjectUpdate }) =>
      projectService.updateProject(projectId, data),
    onSuccess: (_, { projectId }) => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['projects', projectId] });
    },
  });
}

export function useDeleteProjectMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (projectId: string) => projectService.deleteProject(projectId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
    },
  });
}

// Project Members
export function useProjectMembersQuery(projectId: string) {
  return useQuery({
    queryKey: ['projects', projectId, 'members'],
    queryFn: () => projectService.getProjectMembers(projectId),
    enabled: !!projectId,
  });
}

export function useAddProjectMemberMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, data }: { projectId: string; data: ProjectMemberCreate }) =>
      projectService.addProjectMember(projectId, data),
    onSuccess: (_, { projectId }) => {
      queryClient.invalidateQueries({ queryKey: ['projects', projectId, 'members'] });
    },
  });
}

export function useRemoveProjectMemberMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, userId }: { projectId: string; userId: string }) =>
      projectService.removeProjectMember(projectId, userId),
    onSuccess: (_, { projectId }) => {
      queryClient.invalidateQueries({ queryKey: ['projects', projectId, 'members'] });
    },
  });
}

// Tasks
export function useProjectTasksQuery(
  projectId: string,
  status?: TaskStatus,
  assigneeId?: string
) {
  return useQuery({
    queryKey: ['projects', projectId, 'tasks', status, assigneeId],
    queryFn: () => projectService.getProjectTasks(projectId, status, assigneeId),
    enabled: !!projectId,
  });
}

export function useCreateTaskMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, data }: { projectId: string; data: TaskCreate }) =>
      projectService.createTask(projectId, data),
    onSuccess: (_, { projectId }) => {
      queryClient.invalidateQueries({ queryKey: ['projects', projectId, 'tasks'] });
      queryClient.invalidateQueries({ queryKey: ['projects', 'stats'] });
    },
  });
}

export function useUpdateTaskMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, data }: { taskId: string; data: TaskUpdate }) =>
      projectService.updateTask(taskId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
    },
  });
}

export function useDeleteTaskMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (taskId: string) => projectService.deleteTask(taskId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
    },
  });
}

// Time Entries
export function useTimeEntriesQuery(projectId?: string, page: number = 1, pageSize: number = 20) {
  return useQuery({
    queryKey: ['time-entries', projectId, page, pageSize],
    queryFn: () => projectService.getTimeEntries(projectId, page, pageSize),
  });
}

export function useCreateTimeEntryMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: TimeEntryCreate) => projectService.createTimeEntry(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['time-entries'] });
      queryClient.invalidateQueries({ queryKey: ['projects', 'stats'] });
    },
  });
}

export function useUpdateTimeEntryMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ entryId, data }: { entryId: string; data: TimeEntryUpdate }) =>
      projectService.updateTimeEntry(entryId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['time-entries'] });
    },
  });
}

export function useApproveTimeEntryMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (entryId: string) => projectService.approveTimeEntry(entryId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['time-entries'] });
    },
  });
}

export function useDeleteTimeEntryMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (entryId: string) => projectService.deleteTimeEntry(entryId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['time-entries'] });
    },
  });
}

export function useTimeStatsQuery() {
  return useQuery({
    queryKey: ['time-stats'],
    queryFn: () => projectService.getTimeStats(),
  });
}

// AI Costs
export function useAICostsQuery(projectId?: string, page: number = 1, pageSize: number = 20) {
  return useQuery({
    queryKey: ['ai-costs', projectId, page, pageSize],
    queryFn: () => projectService.getAICosts(projectId, page, pageSize),
  });
}

export function useCreateAICostMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: AICostEntryCreate) => projectService.createAICost(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-costs'] });
      queryClient.invalidateQueries({ queryKey: ['projects', 'stats'] });
    },
  });
}

export function useAICostStatsQuery() {
  return useQuery({
    queryKey: ['ai-cost-stats'],
    queryFn: () => projectService.getAICostStats(),
  });
}
