export type InvoiceStatus = 'draft' | 'sent' | 'viewed' | 'paid' | 'overdue' | 'cancelled' | 'refunded';
export type PaymentStatus = 'pending' | 'completed' | 'failed' | 'refunded';
export type PaymentMethod = 'bank_transfer' | 'credit_card' | 'paypal' | 'stripe' | 'cash' | 'other';
export type ExpenseStatus = 'pending' | 'approved' | 'paid' | 'rejected';

// Invoice Item
export interface InvoiceItem {
  id: string;
  invoice_id: string;
  description: string;
  quantity: string;
  unit_price: string;
  total: string;
  sort_order: number;
  created_at: string;
}

export interface InvoiceItemCreate {
  description: string;
  quantity?: string;
  unit_price: string;
  sort_order?: number;
}

// Invoice
export interface Invoice {
  id: string;
  invoice_number: string;
  project_id: string | null;
  customer_id: string;
  issue_date: string;
  due_date: string;
  subtotal: string;
  tax_rate: string;
  tax_amount: string;
  discount: string;
  total: string;
  currency: string;
  status: InvoiceStatus;
  notes: string | null;
  terms: string | null;
  paid_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface InvoiceWithItems extends Invoice {
  items: InvoiceItem[];
  customer_name: string;
  customer_email: string;
  project_name: string | null;
  payments_total: string;
  amount_due: string;
}

export interface InvoiceCreate {
  invoice_number: string;
  project_id?: string | null;
  customer_id: string;
  issue_date: string;
  due_date: string;
  subtotal?: string;
  tax_rate?: string;
  discount?: string;
  currency?: string;
  notes?: string | null;
  terms?: string | null;
  items: InvoiceItemCreate[];
}

export interface InvoiceUpdate {
  invoice_number?: string;
  project_id?: string | null;
  customer_id?: string;
  status?: InvoiceStatus;
  issue_date?: string;
  due_date?: string;
  subtotal?: string;
  tax_rate?: string;
  discount?: string;
  currency?: string;
  notes?: string | null;
  terms?: string | null;
  items?: InvoiceItemCreate[];
}

// Payment
export interface Payment {
  id: string;
  invoice_id: string;
  amount: string;
  currency: string;
  payment_method: PaymentMethod;
  transaction_id: string | null;
  payment_date: string;
  status: PaymentStatus;
  notes: string | null;
  recorded_by: string;
  created_at: string;
}

export interface PaymentWithInvoice extends Payment {
  invoice_number: string;
  customer_name: string;
}

export interface PaymentCreate {
  invoice_id: string;
  amount: string;
  currency?: string;
  payment_method?: PaymentMethod;
  transaction_id?: string | null;
  payment_date: string;
  notes?: string | null;
}

// Expense
export interface Expense {
  id: string;
  project_id: string | null;
  category: string;
  description: string;
  amount: string;
  currency: string;
  expense_date: string;
  receipt_url: string | null;
  status: ExpenseStatus;
  notes: string | null;
  submitted_by: string;
  approved_by: string | null;
  approved_at: string | null;
  paid_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ExpenseWithUser extends Expense {
  submitter_name: string;
  submitter_email: string;
  approver_name: string | null;
  project_name: string | null;
}

export interface ExpenseCreate {
  project_id?: string | null;
  category: string;
  description: string;
  amount: string;
  currency?: string;
  expense_date: string;
  receipt_url?: string | null;
  notes?: string | null;
}

export interface ExpenseUpdate {
  project_id?: string | null;
  category?: string;
  description?: string;
  amount?: string;
  currency?: string;
  expense_date?: string;
  status?: ExpenseStatus;
  receipt_url?: string | null;
  notes?: string | null;
}

// List responses
export interface InvoiceListResponse {
  items: Invoice[];
  total: number;
  page: number;
  page_size: number;
  pages: number;
}

export interface PaymentListResponse {
  items: Payment[];
  total: number;
  page: number;
  page_size: number;
  pages: number;
}

export interface ExpenseListResponse {
  items: Expense[];
  total: number;
  page: number;
  page_size: number;
  pages: number;
}

// Filters
export interface InvoiceFilters {
  customer_id?: string;
  project_id?: string;
  status?: InvoiceStatus;
}

export interface PaymentFilters {
  invoice_id?: string;
  status?: PaymentStatus;
}

export interface ExpenseFilters {
  project_id?: string;
  status?: ExpenseStatus;
  submitted_by?: string;
}

// Statistics
export interface FinanceStats {
  total_revenue: number;
  total_expenses: number;
  outstanding_invoices: number;
  overdue_amount: number;
  paid_this_month: number;
  expenses_this_month: number;
}
