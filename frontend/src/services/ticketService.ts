import { apiClient } from '@/lib/api';
import { ensureResponse, withAuth } from '@/services/base/BaseService';
import type {
  Ticket,
  TicketWithDetails,
  TicketCreate,
  TicketUpdate,
  TicketCategory,
  TicketCategoryCreate,
  TicketCategoryUpdate,
  TicketComment,
  TicketCommentWithAuthor,
  TicketCommentCreate,
  TicketListResponse,
  TicketFilters,
  TicketStats,
} from '@/types/ticket.types';

function buildQueryParams(filters: TicketFilters, page: number, pageSize: number): string {
  const params = new URLSearchParams();
  if (filters.ticket_type) params.append('ticket_type', filters.ticket_type);
  if (filters.status) params.append('status', filters.status);
  if (filters.priority) params.append('priority', filters.priority);
  if (filters.category_id) params.append('category_id', filters.category_id);
  if (filters.department_id) params.append('department_id', filters.department_id);
  if (filters.assignee_id) params.append('assignee_id', filters.assignee_id);
  if (filters.requester_id) params.append('requester_id', filters.requester_id);
  if (filters.team_id) params.append('team_id', filters.team_id);
  if (filters.is_private !== undefined) params.append('is_private', String(filters.is_private));
  if (filters.search) params.append('search', filters.search);
  params.append('page', String(page));
  params.append('page_size', String(pageSize));
  return params.toString();
}

async function getTickets(
  filters: TicketFilters = {},
  page: number = 1,
  pageSize: number = 20
): Promise<TicketListResponse> {
  return withAuth(async () => {
    const query = buildQueryParams(filters, page, pageSize);
    const response = await apiClient.get<TicketListResponse>(`/tickets?${query}`);
    return ensureResponse(response, 'Invalid response from server');
  });
}

async function getTicket(ticketId: string): Promise<TicketWithDetails> {
  return withAuth(async () => {
    const response = await apiClient.get<TicketWithDetails>(`/tickets/${ticketId}`);
    return ensureResponse(response, 'Invalid response from server');
  });
}

async function createTicket(data: TicketCreate): Promise<Ticket> {
  return withAuth(async () => {
    const response = await apiClient.post<Ticket>('/tickets', data);
    return ensureResponse(response, 'Invalid response from server');
  });
}

async function updateTicket(ticketId: string, data: TicketUpdate): Promise<Ticket> {
  return withAuth(async () => {
    const response = await apiClient.patch<Ticket>(`/tickets/${ticketId}`, data);
    return ensureResponse(response, 'Invalid response from server');
  });
}

async function deleteTicket(ticketId: string): Promise<void> {
  return withAuth(async () => {
    await apiClient.delete(`/tickets/${ticketId}`);
  });
}

async function getTicketStats(): Promise<TicketStats> {
  return withAuth(async () => {
    const response = await apiClient.get<TicketStats>('/tickets/stats');
    return ensureResponse(response, 'Invalid response from server');
  });
}

async function getCategories(ticketType?: string): Promise<TicketCategory[]> {
  return withAuth(async () => {
    const query = ticketType ? `?ticket_type=${ticketType}` : '';
    const response = await apiClient.get<TicketCategory[]>(`/tickets/categories${query}`);
    return ensureResponse(response, 'Invalid response from server');
  });
}

async function createCategory(data: TicketCategoryCreate): Promise<TicketCategory> {
  return withAuth(async () => {
    const response = await apiClient.post<TicketCategory>('/tickets/categories', data);
    return ensureResponse(response, 'Invalid response from server');
  });
}

async function updateCategory(categoryId: string, data: TicketCategoryUpdate): Promise<TicketCategory> {
  return withAuth(async () => {
    const response = await apiClient.patch<TicketCategory>(`/tickets/categories/${categoryId}`, data);
    return ensureResponse(response, 'Invalid response from server');
  });
}

async function deleteCategory(categoryId: string): Promise<void> {
  return withAuth(async () => {
    await apiClient.delete(`/tickets/categories/${categoryId}`);
  });
}

async function getComments(ticketId: string): Promise<TicketCommentWithAuthor[]> {
  return withAuth(async () => {
    const response = await apiClient.get<TicketCommentWithAuthor[]>(`/tickets/${ticketId}/comments`);
    return ensureResponse(response, 'Invalid response from server');
  });
}

async function addComment(ticketId: string, data: TicketCommentCreate): Promise<TicketComment> {
  return withAuth(async () => {
    const response = await apiClient.post<TicketComment>(`/tickets/${ticketId}/comments`, data);
    return ensureResponse(response, 'Invalid response from server');
  });
}

async function updateComment(ticketId: string, commentId: string, content: string): Promise<TicketComment> {
  return withAuth(async () => {
    const response = await apiClient.patch<TicketComment>(`/tickets/${ticketId}/comments/${commentId}`, { content });
    return ensureResponse(response, 'Invalid response from server');
  });
}

async function deleteComment(ticketId: string, commentId: string): Promise<void> {
  return withAuth(async () => {
    await apiClient.delete(`/tickets/${ticketId}/comments/${commentId}`);
  });
}

export const ticketService = {
  getTickets,
  getTicket,
  createTicket,
  updateTicket,
  deleteTicket,
  getTicketStats,
  getCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  getComments,
  addComment,
  updateComment,
  deleteComment,
};
