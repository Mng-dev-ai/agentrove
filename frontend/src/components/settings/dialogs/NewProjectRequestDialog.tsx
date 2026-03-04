import { useState, useRef } from 'react';
import { X, Upload, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button';
import { Input } from '@/components/ui/primitives/Input';
import { Textarea } from '@/components/ui/primitives/Textarea';
import { cn } from '@/utils/cn';
import toast from 'react-hot-toast';
import { apiClient } from '@/lib/api';

interface Attachment {
  name: string;
  url: string;
  size: number;
}

interface NewProjectRequestDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export function NewProjectRequestDialog({ isOpen, onClose, onSuccess }: NewProjectRequestDialogProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [budget, setBudget] = useState('');
  const [topics, setTopics] = useState('');
  const [desiredStartDate, setDesiredStartDate] = useState('');
  const [desiredEndDate, setDesiredEndDate] = useState('');
  const [requirements, setRequirements] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsUploading(true);
    try {
      const formData = new FormData();
      for (let i = 0; i < files.length; i++) {
        formData.append('files', files[i]);
      }

      const response = await apiClient.post<{ files: Attachment[] }>('/uploads/', formData);
      setAttachments((prev) => [...prev, ...response.files]);
      toast.success('Files uploaded successfully');
    } catch {
      toast.error('Failed to upload files');
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async () => {
    if (!name.trim() || !description.trim()) {
      toast.error('Project name and description are required');
      return;
    }

    setIsLoading(true);
    try {
      await apiClient.post('/customer/project-requests', {
        name: name.trim(),
        description: description.trim(),
        budget: budget ? parseFloat(budget) : null,
        topics: topics.trim() || null,
        desired_start_date: desiredStartDate || null,
        desired_end_date: desiredEndDate || null,
        requirements: requirements.trim() || null,
        attachments: attachments.length > 0 ? JSON.stringify(attachments) : null,
      });
      toast.success('Project request submitted successfully');
      // Reset form
      setName('');
      setDescription('');
      setBudget('');
      setTopics('');
      setDesiredStartDate('');
      setDesiredEndDate('');
      setRequirements('');
      setAttachments([]);
      onClose();
      onSuccess?.();
    } catch {
      toast.error('Failed to submit project request');
    } finally {
      setIsLoading(false);
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto p-4">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative z-10 w-full max-w-2xl rounded-xl border border-border bg-surface p-6 shadow-strong dark:border-border-dark dark:bg-surface-dark">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-medium text-text-primary dark:text-text-dark-primary">
            New Project Request
          </h2>
          <Button variant="ghost" size="sm" onClick={onClose} className="h-6 w-6 p-0">
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-2">
          <div>
            <label className="mb-1.5 block text-xs text-text-secondary dark:text-text-dark-secondary">
              Project Name *
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., E-commerce Website Development"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs text-text-secondary dark:text-text-dark-secondary">
              Description *
            </label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe your project in detail..."
              rows={4}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-xs text-text-secondary dark:text-text-dark-secondary">
                Budget (USD)
              </label>
              <Input
                type="number"
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
                placeholder="e.g., 5000"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs text-text-secondary dark:text-text-dark-secondary">
                Topics/Tags
              </label>
              <Input
                value={topics}
                onChange={(e) => setTopics(e.target.value)}
                placeholder="e.g., web, mobile, design"
              />
              <p className="mt-1 text-2xs text-text-quaternary dark:text-text-dark-quaternary">
                Separate with commas
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-xs text-text-secondary dark:text-text-dark-secondary">
                Desired Start Date
              </label>
              <Input
                type="date"
                value={desiredStartDate}
                onChange={(e) => setDesiredStartDate(e.target.value)}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs text-text-secondary dark:text-text-dark-secondary">
                Desired End Date
              </label>
              <Input
                type="date"
                value={desiredEndDate}
                onChange={(e) => setDesiredEndDate(e.target.value)}
              />
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-xs text-text-secondary dark:text-text-dark-secondary">
              Requirements
            </label>
            <Textarea
              value={requirements}
              onChange={(e) => setRequirements(e.target.value)}
              placeholder="List specific requirements or features..."
              rows={3}
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs text-text-secondary dark:text-text-dark-secondary">
              Attachments
            </label>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              onChange={handleFileSelect}
              className="hidden"
              accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.zip"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              isLoading={isUploading}
              className="w-full"
            >
              <Upload className="h-3.5 w-3.5 mr-2" />
              Upload Files
            </Button>
            <p className="mt-1 text-2xs text-text-quaternary dark:text-text-dark-quaternary">
              PDF, DOC, PNG, JPG, ZIP files supported
            </p>

            {attachments.length > 0 && (
              <div className="mt-3 space-y-2">
                {attachments.map((file, index) => (
                  <div
                    key={index}
                    className="flex items-center justify-between rounded-lg border border-border bg-surface-secondary p-2 dark:border-border-dark dark:bg-surface-dark-secondary"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-text-primary dark:text-text-dark-primary truncate">
                        {file.name}
                      </p>
                      <p className="text-2xs text-text-quaternary dark:text-text-dark-quaternary">
                        {formatFileSize(file.size)}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeAttachment(index)}
                      className="h-6 w-6 p-0 text-red-500 hover:text-red-600"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-2 border-t border-border pt-4 dark:border-border-dark">
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={handleSubmit} isLoading={isLoading}>
            Submit Request
          </Button>
        </div>
      </div>
    </div>
  );
}
