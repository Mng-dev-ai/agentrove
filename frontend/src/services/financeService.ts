import { apiClient } from '@/lib/api';
import { ensureResponse, withAuth } from '@/services/base/BaseService';
import type {
  Invoice,
  InvoiceWithItems,
  InvoiceCreate,
  InvoiceUpdate,
  InvoiceListResponse,
  InvoiceFilters,
  Payment,
  PaymentCreate,
  PaymentListResponse,
  PaymentFilters,
  Expense,
  ExpenseCreate,
  ExpenseUpdate,
  ExpenseListResponse,
  ExpenseFilters,
  FinanceStats,
} from '@/types/finance.types';

function buildInvoiceQueryParams(filters: InvoiceFilters, page: number, pageSize: number): string {
  const params = new URLSearchParams();
  if (filters.customer_id) params.append('customer_id', filters.customer_id);
  if (filters.project_id) params.append('project_id', filters.project_id);
  if (filters.status) params.append('status', filters.status);
  params.append('page', String(page));
  params.append('page_size', String(pageSize));
  return params.toString();
}

function buildPaymentQueryParams(filters: PaymentFilters, page: number, pageSize: number): string {
  const params = new URLSearchParams();
  if (filters.invoice_id) params.append('invoice_id', filters.invoice_id);
  if (filters.status) params.append('status', filters.status);
  params.append('page', String(page));
  params.append('page_size', String(pageSize));
  return params.toString();
}

function buildExpenseQueryParams(filters: ExpenseFilters, page: number, pageSize: number): string {
  const params = new URLSearchParams();
  if (filters.project_id) params.append('project_id', filters.project_id);
  if (filters.status) params.append('status', filters.status);
  if (filters.submitted_by) params.append('submitted_by', filters.submitted_by);
  params.append('page', String(page));
  params.append('page_size', String(pageSize));
  return params.toString();
}

// Invoice functions
async function getInvoices(
  filters: InvoiceFilters = {},
  page: number = 1,
  pageSize: number = 20
): Promise<InvoiceListResponse> {
  return withAuth(async () => {
    const query = buildInvoiceQueryParams(filters, page, pageSize);
    const response = await apiClient.get<InvoiceListResponse>(`/finance/invoices?${query}`);
    return ensureResponse(response, 'Invalid response from server');
  });
}

async function getInvoice(invoiceId: string): Promise<Invoice> {
  return withAuth(async () => {
    const response = await apiClient.get<Invoice>(`/finance/invoices/${invoiceId}`);
    return ensureResponse(response, 'Invalid response from server');
  });
}

async function createInvoice(data: InvoiceCreate): Promise<Invoice> {
  return withAuth(async () => {
    const response = await apiClient.post<Invoice>('/finance/invoices', data);
    return ensureResponse(response, 'Invalid response from server');
  });
}

async function updateInvoice(invoiceId: string, data: InvoiceUpdate): Promise<Invoice> {
  return withAuth(async () => {
    const response = await apiClient.patch<Invoice>(`/finance/invoices/${invoiceId}`, data);
    return ensureResponse(response, 'Invalid response from server');
  });
}

async function deleteInvoice(invoiceId: string): Promise<void> {
  return withAuth(async () => {
    await apiClient.delete(`/finance/invoices/${invoiceId}`);
  });
}

// Payment functions
async function getPayments(
  filters: PaymentFilters = {},
  page: number = 1,
  pageSize: number = 20
): Promise<PaymentListResponse> {
  return withAuth(async () => {
    const query = buildPaymentQueryParams(filters, page, pageSize);
    const response = await apiClient.get<PaymentListResponse>(`/finance/payments?${query}`);
    return ensureResponse(response, 'Invalid response from server');
  });
}

async function createPayment(data: PaymentCreate): Promise<Payment> {
  return withAuth(async () => {
    const response = await apiClient.post<Payment>('/finance/payments', data);
    return ensureResponse(response, 'Invalid response from server');
  });
}

// Expense functions
async function getExpenses(
  filters: ExpenseFilters = {},
  page: number = 1,
  pageSize: number = 20
): Promise<ExpenseListResponse> {
  return withAuth(async () => {
    const query = buildExpenseQueryParams(filters, page, pageSize);
    const response = await apiClient.get<ExpenseListResponse>(`/finance/expenses?${query}`);
    return ensureResponse(response, 'Invalid response from server');
  });
}

async function getExpense(expenseId: string): Promise<Expense> {
  return withAuth(async () => {
    const response = await apiClient.get<Expense>(`/finance/expenses/${expenseId}`);
    return ensureResponse(response, 'Invalid response from server');
  });
}

async function createExpense(data: ExpenseCreate): Promise<Expense> {
  return withAuth(async () => {
    const response = await apiClient.post<Expense>('/finance/expenses', data);
    return ensureResponse(response, 'Invalid response from server');
  });
}

async function updateExpense(expenseId: string, data: ExpenseUpdate): Promise<Expense> {
  return withAuth(async () => {
    const response = await apiClient.patch<Expense>(`/finance/expenses/${expenseId}`, data);
    return ensureResponse(response, 'Invalid response from server');
  });
}

async function approveExpense(expenseId: string): Promise<Expense> {
  return withAuth(async () => {
    const response = await apiClient.post<Expense>(`/finance/expenses/${expenseId}/approve`);
    return ensureResponse(response, 'Invalid response from server');
  });
}

async function rejectExpense(expenseId: string): Promise<Expense> {
  return withAuth(async () => {
    const response = await apiClient.post<Expense>(`/finance/expenses/${expenseId}/reject`);
    return ensureResponse(response, 'Invalid response from server');
  });
}

async function deleteExpense(expenseId: string): Promise<void> {
  return withAuth(async () => {
    await apiClient.delete(`/finance/expenses/${expenseId}`);
  });
}

// Statistics
async function getFinanceStats(): Promise<FinanceStats> {
  return withAuth(async () => {
    const response = await apiClient.get<FinanceStats>('/finance/stats');
    return ensureResponse(response, 'Invalid response from server');
  });
}

export const financeService = {
  // Invoices
  getInvoices,
  getInvoice,
  createInvoice,
  updateInvoice,
  deleteInvoice,
  // Payments
  getPayments,
  createPayment,
  // Expenses
  getExpenses,
  getExpense,
  createExpense,
  updateExpense,
  approveExpense,
  rejectExpense,
  deleteExpense,
  // Stats
  getFinanceStats,
};
