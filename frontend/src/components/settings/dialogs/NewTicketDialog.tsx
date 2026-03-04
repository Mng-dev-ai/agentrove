import { useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button';
import { Input } from '@/components/ui/primitives/Input';
import { Textarea } from '@/components/ui/primitives/Textarea';
import { cn } from '@/utils/cn';
import toast from 'react-hot-toast';
import { apiClient } from '@/lib/api';

interface NewTicketDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export function NewTicketDialog({ isOpen, onClose, onSuccess }: NewTicketDialogProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState('medium');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async () => {
    if (!title.trim() || !description.trim()) {
      toast.error('Title and description are required');
      return;
    }

    setIsLoading(true);
    try {
      await apiClient.post('/tickets/', {
        title: title.trim(),
        description: description.trim(),
        priority,
        ticket_type: 'general',
      });
      toast.success('Ticket created successfully');
      setTitle('');
      setDescription('');
      setPriority('medium');
      onClose();
      onSuccess?.();
    } catch {
      toast.error('Failed to create ticket');
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative z-10 w-full max-w-lg rounded-xl border border-border bg-surface p-6 shadow-strong dark:border-border-dark dark:bg-surface-dark">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-medium text-text-primary dark:text-text-dark-primary">
            New Support Ticket
          </h2>
          <Button variant="ghost" size="sm" onClick={onClose} className="h-6 w-6 p-0">
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-xs text-text-secondary dark:text-text-dark-secondary">
              Title *
            </label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Brief description of your issue"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs text-text-secondary dark:text-text-dark-secondary">
              Description *
            </label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Detailed description of your issue or request..."
              rows={4}
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs text-text-secondary dark:text-text-dark-secondary">
              Priority
            </label>
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              className={cn(
                'w-full rounded-lg border border-border bg-surface-secondary px-3 py-2 text-xs',
                'text-text-primary dark:border-border-dark dark:bg-surface-dark-secondary dark:text-text-dark-primary'
              )}
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={handleSubmit} isLoading={isLoading}>
            Create Ticket
          </Button>
        </div>
      </div>
    </div>
  );
}
