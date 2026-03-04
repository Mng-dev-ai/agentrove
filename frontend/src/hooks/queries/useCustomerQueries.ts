import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { customerService } from '@/services/customerService';
import type {
  BankAccountCreate,
  BankAccountUpdate,
  PaymentNotificationCreate,
  ProjectRequestCreate,
  ProjectRequestReview,
} from '@/types/customer.types';

// Bank Accounts (Admin)
export function useBankAccounts(activeOnly: boolean = true) {
  return useQuery({
    queryKey: ['customer', 'bank-accounts', activeOnly],
    queryFn: () => customerService.getBankAccounts(activeOnly),
  });
}

export function useCreateBankAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: BankAccountCreate) => customerService.createBankAccount(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customer', 'bank-accounts'] });
    },
  });
}

export function useUpdateBankAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ accountId, data }: { accountId: string; data: BankAccountUpdate }) =>
      customerService.updateBankAccount(accountId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customer', 'bank-accounts'] });
    },
  });
}

export function useDeleteBankAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (accountId: string) => customerService.deleteBankAccount(accountId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customer', 'bank-accounts'] });
    },
  });
}

// Bank Info (Customer)
export function useBankInfo() {
  return useQuery({
    queryKey: ['customer', 'bank-info'],
    queryFn: () => customerService.getBankInfo(),
  });
}

// Payment Notifications (Admin/Manager)
export function usePaymentNotifications(status?: string, customerId?: string, page = 1, pageSize = 20) {
  return useQuery({
    queryKey: ['customer', 'payment-notifications', status, customerId, page, pageSize],
    queryFn: () => customerService.getPaymentNotifications(status, customerId, page, pageSize),
  });
}

// My Payment Notifications (Customer)
export function useMyPaymentNotifications(page = 1, pageSize = 20) {
  return useQuery({
    queryKey: ['customer', 'my-payment-notifications', page, pageSize],
    queryFn: () => customerService.getMyPaymentNotifications(page, pageSize),
  });
}

export function useCreatePaymentNotification() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: PaymentNotificationCreate) => customerService.createPaymentNotification(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customer', 'payment-notifications'] });
      queryClient.invalidateQueries({ queryKey: ['customer', 'my-payment-notifications'] });
    },
  });
}

export function useVerifyPaymentNotification() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (notificationId: string) => customerService.verifyPaymentNotification(notificationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customer', 'payment-notifications'] });
      queryClient.invalidateQueries({ queryKey: ['tickets'] });
    },
  });
}

export function useRejectPaymentNotification() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (notificationId: string) => customerService.rejectPaymentNotification(notificationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customer', 'payment-notifications'] });
      queryClient.invalidateQueries({ queryKey: ['tickets'] });
    },
  });
}

// Project Requests (Admin/Manager)
export function useProjectRequests(status?: string, customerId?: string, page = 1, pageSize = 20) {
  return useQuery({
    queryKey: ['customer', 'project-requests', status, customerId, page, pageSize],
    queryFn: () => customerService.getProjectRequests(status, customerId, page, pageSize),
  });
}

// My Project Requests (Customer)
export function useMyProjectRequests(page = 1, pageSize = 20) {
  return useQuery({
    queryKey: ['customer', 'my-project-requests', page, pageSize],
    queryFn: () => customerService.getMyProjectRequests(page, pageSize),
  });
}

export function useCreateProjectRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: ProjectRequestCreate) => customerService.createProjectRequest(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customer', 'project-requests'] });
      queryClient.invalidateQueries({ queryKey: ['customer', 'my-project-requests'] });
    },
  });
}

export function useReviewProjectRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ requestId, data }: { requestId: string; data: ProjectRequestReview }) =>
      customerService.reviewProjectRequest(requestId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customer', 'project-requests'] });
      queryClient.invalidateQueries({ queryKey: ['tickets'] });
    },
  });
}

export function useConvertProjectRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ requestId, projectId }: { requestId: string; projectId: string }) =>
      customerService.convertProjectRequest(requestId, projectId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customer', 'project-requests'] });
      queryClient.invalidateQueries({ queryKey: ['projects'] });
    },
  });
}
