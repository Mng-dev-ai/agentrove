import { useState, useEffect, useCallback } from 'react';
import { Plus, Ticket as TicketIcon, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button';
import { NewTicketDialog } from '@/components/settings/dialogs/NewTicketDialog';
import { useCurrentUserQuery } from '@/hooks/queries/useAuthQueries';
import { apiClient } from '@/lib/api';
import { cn } from '@/utils/cn';
import toast from 'react-hot-toast';

interface Ticket {
  id: string;
  ticket_number: number;
  title: string;
  description: string;
  status: string;
  priority: string;
  created_at: string;
}

export function TicketsSection() {
  const [showNewTicket, setShowNewTicket] = useState(false);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const { data: currentUser, isLoading: isUserLoading } = useCurrentUserQuery();

  const loadTickets = useCallback(async () => {
    if (!currentUser) return;

    setIsLoading(true);
    try {
      const response = await apiClient.get<{ items: Ticket[] }>('/tickets?page=1&per_page=20');
      setTickets(response?.items || []);
    } catch (err) {
      const error = err as Error & { status?: number };
      // Don't show toast for auth errors - they're expected if not logged in
      if (error.status !== 401 && error.status !== 403) {
        toast.error('Failed to load tickets');
      }
    } finally {
      setIsLoading(false);
    }
  }, [currentUser]);

  useEffect(() => {
    if (isUserLoading) return;
    loadTickets();
  }, [isUserLoading, loadTickets, refreshKey]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'open':
        return 'bg-blue-500/10 text-blue-500';
      case 'in_progress':
        return 'bg-yellow-500/10 text-yellow-500';
      case 'resolved':
        return 'bg-green-500/10 text-green-500';
      case 'closed':
        return 'bg-gray-500/10 text-gray-500';
      default:
        return 'bg-gray-500/10 text-gray-500';
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'urgent':
      case 'critical':
        return 'text-red-500';
      case 'high':
        return 'text-orange-500';
      case 'medium':
        return 'text-yellow-500';
      default:
        return 'text-gray-400';
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium text-text-primary dark:text-text-dark-primary">
            Support Tickets
          </h3>
          <p className="mt-0.5 text-xs text-text-tertiary dark:text-text-dark-tertiary">
            Manage and track support tickets
          </p>
        </div>
        <Button size="sm" onClick={() => setShowNewTicket(true)}>
          <Plus className="h-3.5 w-3.5 mr-1" />
          New Ticket
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-text-quaternary dark:text-text-dark-quaternary" />
        </div>
      ) : tickets.length === 0 ? (
        <div className="rounded-xl border border-border p-8 text-center dark:border-border-dark">
          <TicketIcon className="h-8 w-8 mx-auto mb-2 text-text-quaternary dark:text-text-dark-quaternary" />
          <p className="text-xs text-text-tertiary dark:text-text-dark-tertiary">
            No tickets yet
          </p>
          <p className="mt-1 text-2xs text-text-quaternary dark:text-text-dark-quaternary">
            Create a new ticket to get started
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {tickets.map((ticket) => (
            <div
              key={ticket.id}
              className={cn(
                'rounded-lg border border-border p-3 dark:border-border-dark',
                'hover:bg-surface-hover dark:hover:bg-surface-dark-hover transition-colors cursor-pointer'
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-2xs font-mono text-text-quaternary dark:text-text-dark-quaternary">
                      #{ticket.ticket_number}
                    </span>
                    <h4 className="text-xs font-medium text-text-primary dark:text-text-dark-primary truncate">
                      {ticket.title}
                    </h4>
                  </div>
                  <p className="mt-0.5 text-2xs text-text-tertiary dark:text-text-dark-tertiary line-clamp-1">
                    {ticket.description}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={cn('px-2 py-0.5 rounded text-2xs capitalize', getStatusColor(ticket.status))}>
                    {ticket.status.replace('_', ' ')}
                  </span>
                </div>
              </div>
              <div className="mt-2 flex items-center gap-3 text-2xs text-text-quaternary dark:text-text-dark-quaternary">
                <span className={cn('capitalize', getPriorityColor(ticket.priority))}>
                  {ticket.priority}
                </span>
                <span>•</span>
                <span>{new Date(ticket.created_at).toLocaleDateString()}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      <NewTicketDialog
        isOpen={showNewTicket}
        onClose={() => setShowNewTicket(false)}
        onSuccess={() => setRefreshKey((k) => k + 1)}
      />
    </div>
  );
}
