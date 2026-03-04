import { useQuery } from '@tanstack/react-query';
import { reportsService } from '@/services/reportsService';

// Project Report
export function useProjectReport() {
  return useQuery({
    queryKey: ['reports', 'projects'],
    queryFn: () => reportsService.getProjectReport(),
  });
}

// Time Tracking Report
export function useTimeTrackingReport(
  startDate?: string,
  endDate?: string,
  userId?: string,
  projectId?: string
) {
  return useQuery({
    queryKey: ['reports', 'time-tracking', startDate, endDate, userId, projectId],
    queryFn: () => reportsService.getTimeTrackingReport(startDate, endDate, userId, projectId),
    enabled: !!(startDate && endDate),
  });
}

// AI Cost Report
export function useAICostReport(
  startDate?: string,
  endDate?: string,
  userId?: string,
  projectId?: string
) {
  return useQuery({
    queryKey: ['reports', 'ai-costs', startDate, endDate, userId, projectId],
    queryFn: () => reportsService.getAICostReport(startDate, endDate, userId, projectId),
  });
}

// Financial Report
export function useFinancialReport(startDate?: string, endDate?: string) {
  return useQuery({
    queryKey: ['reports', 'financial', startDate, endDate],
    queryFn: () => reportsService.getFinancialReport(startDate, endDate),
  });
}

// Ticket Report
export function useTicketReport(startDate?: string, endDate?: string) {
  return useQuery({
    queryKey: ['reports', 'tickets', startDate, endDate],
    queryFn: () => reportsService.getTicketReport(startDate, endDate),
  });
}

// Customer Dashboard
export function useCustomerDashboard() {
  return useQuery({
    queryKey: ['reports', 'dashboard', 'customer'],
    queryFn: () => reportsService.getCustomerDashboard(),
  });
}

// Manager Dashboard
export function useManagerDashboard() {
  return useQuery({
    queryKey: ['reports', 'dashboard', 'manager'],
    queryFn: () => reportsService.getManagerDashboard(),
  });
}

// Admin Dashboard
export function useAdminDashboard() {
  return useQuery({
    queryKey: ['reports', 'dashboard', 'admin'],
    queryFn: () => reportsService.getAdminDashboard(),
  });
}
