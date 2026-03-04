// Project Stats
export interface ProjectStats {
  total_projects: number;
  by_status: Record<string, number>;
  active_project_ids: string[];
}

// Time Tracking Report
export interface TimeTrackingReport {
  total_hours: number;
  billable_hours: number;
  total_entries: number;
  by_user: Record<string, number>;
  by_project: Record<string, number>;
}

// AI Cost Report
export interface AIProviderStats {
  cost: number;
  input_tokens: number;
  output_tokens: number;
}

export interface AICostReport {
  total_cost_usd: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_entries: number;
  by_provider: Record<string, AIProviderStats>;
  by_model: Record<string, number>;
}

// Financial Report
export interface InvoiceStatusStats {
  count: number;
  total: number;
}

export interface FinancialReport {
  total_revenue: number;
  total_expenses: number;
  net_profit: number;
  outstanding_invoices: number;
  overdue_amount: number;
  invoices_by_status: Record<string, InvoiceStatusStats>;
  expenses_by_category: Record<string, number>;
}

// Ticket Report
export interface TicketReport {
  total_tickets: number;
  open_tickets: number;
  by_status: Record<string, number>;
  by_priority: Record<string, number>;
  by_type: Record<string, number>;
}

// Customer Dashboard
export interface CustomerDashboard {
  active_projects: number;
  total_project_requests: number;
  pending_project_requests: number;
  total_payment_notifications: number;
  pending_payments: number;
  total_paid: number;
}

// Manager Dashboard
export interface ManagerDashboard {
  projects: ProjectStats;
  finance: FinancialReport;
  tickets: TicketReport;
  pending_payment_notifications: number;
  pending_project_requests: number;
}

// Admin Dashboard
export interface UserStats {
  total: number;
  active: number;
  by_role: Record<string, number>;
}

export interface AdminDashboard extends ManagerDashboard {
  users: UserStats;
  ai_costs: AICostReport;
}
