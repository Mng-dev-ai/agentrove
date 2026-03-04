// Bank Account types
export interface BankAccount {
  id: string;
  name: string;
  bank_name: string;
  account_holder: string;
  iban: string;
  account_number: string | null;
  routing_number: string | null;
  swift_bic: string | null;
  currency: string;
  is_primary: boolean;
  is_active: boolean;
  notes: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface BankAccountCreate {
  name: string;
  bank_name: string;
  account_holder: string;
  iban: string;
  account_number?: string | null;
  routing_number?: string | null;
  swift_bic?: string | null;
  currency?: string;
  is_primary?: boolean;
  notes?: string | null;
}

export interface BankAccountUpdate {
  name?: string;
  bank_name?: string;
  account_holder?: string;
  iban?: string;
  account_number?: string | null;
  routing_number?: string | null;
  swift_bic?: string | null;
  currency?: string;
  is_primary?: boolean;
  is_active?: boolean;
  notes?: string | null;
}

// Payment Notification types
export interface PaymentNotification {
  id: string;
  customer_id: string;
  project_id: string | null;
  invoice_id: string | null;
  amount: string;
  currency: string;
  payment_date: string;
  payment_method: string;
  sender_name: string | null;
  sender_bank: string | null;
  reference_number: string | null;
  receipt_file_url: string | null;
  receipt_file_name: string | null;
  notes: string | null;
  status: 'pending' | 'verified' | 'rejected';
  ticket_id: string | null;
  verified_by: string | null;
  verified_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PaymentNotificationCreate {
  project_id?: string | null;
  invoice_id?: string | null;
  amount: string;
  currency?: string;
  payment_date: string;
  payment_method: string;
  sender_name?: string | null;
  sender_bank?: string | null;
  reference_number?: string | null;
  receipt_file_url?: string | null;
  receipt_file_name?: string | null;
  notes?: string | null;
}

export interface PaymentNotificationListResponse {
  items: PaymentNotification[];
  total: number;
  page: number;
  page_size: number;
  pages: number;
}

// Project Request types
export interface ProjectRequest {
  id: string;
  customer_id: string;
  name: string;
  description: string;
  budget_range: string | null;
  desired_start_date: string | null;
  desired_end_date: string | null;
  requirements: string | null;
  attachment_url: string | null;
  attachment_name: string | null;
  status: 'pending' | 'reviewing' | 'approved' | 'rejected' | 'converted';
  ticket_id: string | null;
  project_id: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectRequestCreate {
  name: string;
  description: string;
  budget_range?: string | null;
  desired_start_date?: string | null;
  desired_end_date?: string | null;
  requirements?: string | null;
  attachment_url?: string | null;
  attachment_name?: string | null;
}

export interface ProjectRequestReview {
  status: 'approved' | 'rejected';
  review_notes?: string | null;
}

export interface ProjectRequestListResponse {
  items: ProjectRequest[];
  total: number;
  page: number;
  page_size: number;
  pages: number;
}
