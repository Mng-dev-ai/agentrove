import { apiClient } from '@/lib/api';
import { ensureResponse, withAuth } from '@/services/base/BaseService';
import type {
  ProjectStats,
  TimeTrackingReport,
  AICostReport,
  FinancialReport,
  TicketReport,
  CustomerDashboard,
  ManagerDashboard,
  AdminDashboard,
} from '@/types/reports.types';

async function getProjectReport(): Promise<ProjectStats> {
  return withAuth(async () => {
    const response = await apiClient.get<ProjectStats>('/reports/projects');
    return ensureResponse(response, 'Invalid response from server');
  });
}

async function getTimeTrackingReport(
  startDate?: string,
  endDate?: string,
  userId?: string,
  projectId?: string
): Promise<TimeTrackingReport> {
  return withAuth(async () => {
    const params = new URLSearchParams();
    if (startDate) params.append('start_date', startDate);
    if (endDate) params.append('end_date', endDate);
    if (userId) params.append('user_id', userId);
    if (projectId) params.append('project_id', projectId);
    const response = await apiClient.get<TimeTrackingReport>(`/reports/time-tracking?${params}`);
    return ensureResponse(response, 'Invalid response from server');
  });
}

async function getAICostReport(
  startDate?: string,
  endDate?: string,
  userId?: string,
  projectId?: string
): Promise<AICostReport> {
  return withAuth(async () => {
    const params = new URLSearchParams();
    if (startDate) params.append('start_date', startDate);
    if (endDate) params.append('end_date', endDate);
    if (userId) params.append('user_id', userId);
    if (projectId) params.append('project_id', projectId);
    const response = await apiClient.get<AICostReport>(`/reports/ai-costs?${params}`);
    return ensureResponse(response, 'Invalid response from server');
  });
}

async function getFinancialReport(
  startDate?: string,
  endDate?: string
): Promise<FinancialReport> {
  return withAuth(async () => {
    const params = new URLSearchParams();
    if (startDate) params.append('start_date', startDate);
    if (endDate) params.append('end_date', endDate);
    const response = await apiClient.get<FinancialReport>(`/reports/financial?${params}`);
    return ensureResponse(response, 'Invalid response from server');
  });
}

async function getTicketReport(
  startDate?: string,
  endDate?: string
): Promise<TicketReport> {
  return withAuth(async () => {
    const params = new URLSearchParams();
    if (startDate) params.append('start_date', startDate);
    if (endDate) params.append('end_date', endDate);
    const response = await apiClient.get<TicketReport>(`/reports/tickets?${params}`);
    return ensureResponse(response, 'Invalid response from server');
  });
}

async function getCustomerDashboard(): Promise<CustomerDashboard> {
  return withAuth(async () => {
    const response = await apiClient.get<CustomerDashboard>('/reports/dashboard/customer');
    return ensureResponse(response, 'Invalid response from server');
  });
}

async function getManagerDashboard(): Promise<ManagerDashboard> {
  return withAuth(async () => {
    const response = await apiClient.get<ManagerDashboard>('/reports/dashboard/manager');
    return ensureResponse(response, 'Invalid response from server');
  });
}

async function getAdminDashboard(): Promise<AdminDashboard> {
  return withAuth(async () => {
    const response = await apiClient.get<AdminDashboard>('/reports/dashboard/admin');
    return ensureResponse(response, 'Invalid response from server');
  });
}

export const reportsService = {
  getProjectReport,
  getTimeTrackingReport,
  getAICostReport,
  getFinancialReport,
  getTicketReport,
  getCustomerDashboard,
  getManagerDashboard,
  getAdminDashboard,
};
