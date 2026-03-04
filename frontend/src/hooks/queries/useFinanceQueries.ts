import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { financeService } from '@/services/financeService';
import type {
  InvoiceFilters,
  InvoiceCreate,
  InvoiceUpdate,
  PaymentFilters,
  PaymentCreate,
  ExpenseFilters,
  ExpenseCreate,
  ExpenseUpdate,
} from '@/types/finance.types';

// Invoice queries
export function useInvoices(filters: InvoiceFilters = {}, page = 1, pageSize = 20) {
  return useQuery({
    queryKey: ['finance', 'invoices', filters, page, pageSize],
    queryFn: () => financeService.getInvoices(filters, page, pageSize),
  });
}

export function useInvoice(invoiceId: string | undefined) {
  return useQuery({
    queryKey: ['finance', 'invoices', invoiceId],
    queryFn: () => financeService.getInvoice(invoiceId!),
    enabled: !!invoiceId,
  });
}

export function useCreateInvoice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: InvoiceCreate) => financeService.createInvoice(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['finance', 'invoices'] });
    },
  });
}

export function useUpdateInvoice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ invoiceId, data }: { invoiceId: string; data: InvoiceUpdate }) =>
      financeService.updateInvoice(invoiceId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['finance', 'invoices'] });
    },
  });
}

export function useDeleteInvoice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (invoiceId: string) => financeService.deleteInvoice(invoiceId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['finance', 'invoices'] });
    },
  });
}

// Payment queries
export function usePayments(filters: PaymentFilters = {}, page = 1, pageSize = 20) {
  return useQuery({
    queryKey: ['finance', 'payments', filters, page, pageSize],
    queryFn: () => financeService.getPayments(filters, page, pageSize),
  });
}

export function useCreatePayment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: PaymentCreate) => financeService.createPayment(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['finance', 'payments'] });
      queryClient.invalidateQueries({ queryKey: ['finance', 'invoices'] });
      queryClient.invalidateQueries({ queryKey: ['finance', 'stats'] });
    },
  });
}

// Expense queries
export function useExpenses(filters: ExpenseFilters = {}, page = 1, pageSize = 20) {
  return useQuery({
    queryKey: ['finance', 'expenses', filters, page, pageSize],
    queryFn: () => financeService.getExpenses(filters, page, pageSize),
  });
}

export function useExpense(expenseId: string | undefined) {
  return useQuery({
    queryKey: ['finance', 'expenses', expenseId],
    queryFn: () => financeService.getExpense(expenseId!),
    enabled: !!expenseId,
  });
}

export function useCreateExpense() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: ExpenseCreate) => financeService.createExpense(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['finance', 'expenses'] });
    },
  });
}

export function useUpdateExpense() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ expenseId, data }: { expenseId: string; data: ExpenseUpdate }) =>
      financeService.updateExpense(expenseId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['finance', 'expenses'] });
    },
  });
}

export function useApproveExpense() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (expenseId: string) => financeService.approveExpense(expenseId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['finance', 'expenses'] });
      queryClient.invalidateQueries({ queryKey: ['finance', 'stats'] });
    },
  });
}

export function useRejectExpense() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (expenseId: string) => financeService.rejectExpense(expenseId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['finance', 'expenses'] });
    },
  });
}

export function useDeleteExpense() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (expenseId: string) => financeService.deleteExpense(expenseId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['finance', 'expenses'] });
    },
  });
}

// Stats
export function useFinanceStats() {
  return useQuery({
    queryKey: ['finance', 'stats'],
    queryFn: () => financeService.getFinanceStats(),
  });
}
