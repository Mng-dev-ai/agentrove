import { apiClient } from '@/lib/api';
import { ensureResponse, withAuth } from '@/services/base/BaseService';
import type {
  BankAccount,
  BankAccountCreate,
  BankAccountUpdate,
  PaymentNotification,
  PaymentNotificationCreate,
  PaymentNotificationListResponse,
  ProjectRequest,
  ProjectRequestCreate,
  ProjectRequestReview,
  ProjectRequestListResponse,
} from '@/types/customer.types';

// Bank Accounts (Admin)
async function getBankAccounts(activeOnly: boolean = true): Promise<BankAccount[]> {
  return withAuth(async () => {
    const response = await apiClient.get<BankAccount[]>(`/customer/bank-accounts?active_only=${activeOnly}`);
    return ensureResponse(response, 'Invalid response from server');
  });
}

async function createBankAccount(data: BankAccountCreate): Promise<BankAccount> {
  return withAuth(async () => {
    const response = await apiClient.post<BankAccount>('/customer/bank-accounts', data);
    return ensureResponse(response, 'Invalid response from server');
  });
}

async function updateBankAccount(accountId: string, data: BankAccountUpdate): Promise<BankAccount> {
  return withAuth(async () => {
    const response = await apiClient.patch<BankAccount>(`/customer/bank-accounts/${accountId}`, data);
    return ensureResponse(response, 'Invalid response from server');
  });
}

async function deleteBankAccount(accountId: string): Promise<void> {
  return withAuth(async () => {
    await apiClient.delete(`/customer/bank-accounts/${accountId}`);
  });
}

// Bank Info (Customer view)
async function getBankInfo(): Promise<BankAccount[]> {
  return withAuth(async () => {
    const response = await apiClient.get<BankAccount[]>('/customer/bank-info');
    return ensureResponse(response, 'Invalid response from server');
  });
}

// Payment Notifications
async function getPaymentNotifications(
  status?: string,
  customerId?: string,
  page: number = 1,
  pageSize: number = 20
): Promise<PaymentNotificationListResponse> {
  return withAuth(async () => {
    const params = new URLSearchParams();
    if (status) params.append('status', status);
    if (customerId) params.append('customer_id', customerId);
    params.append('page', String(page));
    params.append('page_size', String(pageSize));
    const response = await apiClient.get<PaymentNotificationListResponse>(`/customer/payment-notifications?${params}`);
    return ensureResponse(response, 'Invalid response from server');
  });
}

async function getMyPaymentNotifications(
  page: number = 1,
  pageSize: number = 20
): Promise<PaymentNotificationListResponse> {
  return withAuth(async () => {
    const params = new URLSearchParams();
    params.append('page', String(page));
    params.append('page_size', String(pageSize));
    const response = await apiClient.get<PaymentNotificationListResponse>(`/customer/payment-notifications/my?${params}`);
    return ensureResponse(response, 'Invalid response from server');
  });
}

async function createPaymentNotification(data: PaymentNotificationCreate): Promise<PaymentNotification> {
  return withAuth(async () => {
    const response = await apiClient.post<PaymentNotification>('/customer/payment-notifications', data);
    return ensureResponse(response, 'Invalid response from server');
  });
}

async function verifyPaymentNotification(notificationId: string): Promise<PaymentNotification> {
  return withAuth(async () => {
    const response = await apiClient.post<PaymentNotification>(`/customer/payment-notifications/${notificationId}/verify`);
    return ensureResponse(response, 'Invalid response from server');
  });
}

async function rejectPaymentNotification(notificationId: string): Promise<PaymentNotification> {
  return withAuth(async () => {
    const response = await apiClient.post<PaymentNotification>(`/customer/payment-notifications/${notificationId}/reject`);
    return ensureResponse(response, 'Invalid response from server');
  });
}

// Project Requests
async function getProjectRequests(
  status?: string,
  customerId?: string,
  page: number = 1,
  pageSize: number = 20
): Promise<ProjectRequestListResponse> {
  return withAuth(async () => {
    const params = new URLSearchParams();
    if (status) params.append('status', status);
    if (customerId) params.append('customer_id', customerId);
    params.append('page', String(page));
    params.append('page_size', String(pageSize));
    const response = await apiClient.get<ProjectRequestListResponse>(`/customer/project-requests?${params}`);
    return ensureResponse(response, 'Invalid response from server');
  });
}

async function getMyProjectRequests(
  page: number = 1,
  pageSize: number = 20
): Promise<ProjectRequestListResponse> {
  return withAuth(async () => {
    const params = new URLSearchParams();
    params.append('page', String(page));
    params.append('page_size', String(pageSize));
    const response = await apiClient.get<ProjectRequestListResponse>(`/customer/project-requests/my?${params}`);
    return ensureResponse(response, 'Invalid response from server');
  });
}

async function createProjectRequest(data: ProjectRequestCreate): Promise<ProjectRequest> {
  return withAuth(async () => {
    const response = await apiClient.post<ProjectRequest>('/customer/project-requests', data);
    return ensureResponse(response, 'Invalid response from server');
  });
}

async function reviewProjectRequest(requestId: string, data: ProjectRequestReview): Promise<ProjectRequest> {
  return withAuth(async () => {
    const response = await apiClient.post<ProjectRequest>(`/customer/project-requests/${requestId}/review`, data);
    return ensureResponse(response, 'Invalid response from server');
  });
}

async function convertProjectRequest(requestId: string, projectId: string): Promise<ProjectRequest> {
  return withAuth(async () => {
    const response = await apiClient.post<ProjectRequest>(
      `/customer/project-requests/${requestId}/convert?project_id=${projectId}`
    );
    return ensureResponse(response, 'Invalid response from server');
  });
}

export const customerService = {
  // Bank Accounts (Admin)
  getBankAccounts,
  createBankAccount,
  updateBankAccount,
  deleteBankAccount,
  // Bank Info (Customer)
  getBankInfo,
  // Payment Notifications
  getPaymentNotifications,
  getMyPaymentNotifications,
  createPaymentNotification,
  verifyPaymentNotification,
  rejectPaymentNotification,
  // Project Requests
  getProjectRequests,
  getMyProjectRequests,
  createProjectRequest,
  reviewProjectRequest,
  convertProjectRequest,
};
