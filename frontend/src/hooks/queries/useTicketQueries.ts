import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ticketService } from '@/services/ticketService';
import type {
  TicketCreate,
  TicketUpdate,
  TicketCategoryCreate,
  TicketCategoryUpdate,
  TicketCommentCreate,
  TicketFilters,
} from '@/types/ticket.types';

export function useTicketsQuery(filters: TicketFilters = {}, page: number = 1, pageSize: number = 20) {
  return useQuery({
    queryKey: ['tickets', filters, page, pageSize],
    queryFn: () => ticketService.getTickets(filters, page, pageSize),
  });
}

export function useTicketQuery(ticketId: string) {
  return useQuery({
    queryKey: ['tickets', ticketId],
    queryFn: () => ticketService.getTicket(ticketId),
    enabled: !!ticketId,
  });
}

export function useTicketStatsQuery() {
  return useQuery({
    queryKey: ['tickets', 'stats'],
    queryFn: () => ticketService.getTicketStats(),
  });
}

export function useTicketCategoriesQuery(ticketType?: string) {
  return useQuery({
    queryKey: ['tickets', 'categories', ticketType],
    queryFn: () => ticketService.getCategories(ticketType),
  });
}

export function useTicketCommentsQuery(ticketId: string) {
  return useQuery({
    queryKey: ['tickets', ticketId, 'comments'],
    queryFn: () => ticketService.getComments(ticketId),
    enabled: !!ticketId,
  });
}

export function useCreateTicketMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: TicketCreate) => ticketService.createTicket(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tickets'] });
    },
  });
}

export function useUpdateTicketMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ ticketId, data }: { ticketId: string; data: TicketUpdate }) =>
      ticketService.updateTicket(ticketId, data),
    onSuccess: (_, { ticketId }) => {
      queryClient.invalidateQueries({ queryKey: ['tickets'] });
      queryClient.invalidateQueries({ queryKey: ['tickets', ticketId] });
    },
  });
}

export function useDeleteTicketMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (ticketId: string) => ticketService.deleteTicket(ticketId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tickets'] });
    },
  });
}

export function useCreateCategoryMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: TicketCategoryCreate) => ticketService.createCategory(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tickets', 'categories'] });
    },
  });
}

export function useUpdateCategoryMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ categoryId, data }: { categoryId: string; data: TicketCategoryUpdate }) =>
      ticketService.updateCategory(categoryId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tickets', 'categories'] });
    },
  });
}

export function useDeleteCategoryMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (categoryId: string) => ticketService.deleteCategory(categoryId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tickets', 'categories'] });
    },
  });
}

export function useAddCommentMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ ticketId, data }: { ticketId: string; data: TicketCommentCreate }) =>
      ticketService.addComment(ticketId, data),
    onSuccess: (_, { ticketId }) => {
      queryClient.invalidateQueries({ queryKey: ['tickets', ticketId, 'comments'] });
      queryClient.invalidateQueries({ queryKey: ['tickets', ticketId] });
    },
  });
}

export function useUpdateCommentMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      ticketId,
      commentId,
      content,
    }: {
      ticketId: string;
      commentId: string;
      content: string;
    }) => ticketService.updateComment(ticketId, commentId, content),
    onSuccess: (_, { ticketId }) => {
      queryClient.invalidateQueries({ queryKey: ['tickets', ticketId, 'comments'] });
    },
  });
}

export function useDeleteCommentMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ ticketId, commentId }: { ticketId: string; commentId: string }) =>
      ticketService.deleteComment(ticketId, commentId),
    onSuccess: (_, { ticketId }) => {
      queryClient.invalidateQueries({ queryKey: ['tickets', ticketId, 'comments'] });
    },
  });
}
