import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader2, CheckCircle2, Clock, AlertCircle, Upload, Trash2, Plus } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button';
import { Input } from '@/components/ui/primitives/Input';
import { Textarea } from '@/components/ui/primitives/Textarea';
import { apiClient } from '@/lib/api';
import { cn } from '@/utils/cn';
import toast from 'react-hot-toast';

interface Project {
  id: string;
  name: string;
  key: string;
  description: string | null;
  status: string;
  priority: string;
  budget: number | null;
  start_date: string | null;
  due_date: string | null;
  customer_id: string | null;
  owner_id: string;
  created_at: string;
}

interface Task {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  due_date: string | null;
  created_at: string;
}

interface ProjectNote {
  id: string;
  content: string;
  created_at: string;
  author_name: string;
}

interface Attachment {
  name: string;
  url: string;
  size: number;
}

export function ProjectDetailsSection() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const [project, setProject] = useState<Project | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [notes, setNotes] = useState<ProjectNote[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [newNote, setNewNote] = useState('');
  const [isAddingNote, setIsAddingNote] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (projectId) {
      loadProject();
    }
  }, [projectId]);

  const loadProject = async () => {
    setIsLoading(true);
    try {
      const projectRes = await apiClient.get<{ project: Project }>(`/projects/${projectId}`);
      setProject(projectRes.project || projectRes);

      // Load tasks
      try {
        const tasksRes = await apiClient.get<{ tasks: Task[] }>(`/projects/${projectId}/tasks`);
        setTasks(tasksRes.tasks || []);
      } catch {
        setTasks([]);
      }

      // Load notes (if endpoint exists)
      try {
        const notesRes = await apiClient.get<{ notes: ProjectNote[] }>(`/projects/${projectId}/notes`);
        setNotes(notesRes.notes || []);
      } catch {
        setNotes([]);
      }

      // Load attachments from project data
      if (projectRes.project?.attachments) {
        try {
          setAttachments(JSON.parse(projectRes.project.attachments));
        } catch {
          setAttachments([]);
        }
      }
    } catch {
      toast.error('Failed to load project');
      navigate('/settings');
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddNote = async () => {
    if (!newNote.trim()) return;

    setIsAddingNote(true);
    try {
      const response = await apiClient.post(`/projects/${projectId}/notes`, {
        content: newNote.trim(),
      });
      setNotes((prev) => [...prev, response.note || response]);
      setNewNote('');
      toast.success('Note added');
    } catch {
      toast.error('Failed to add note');
    } finally {
      setIsAddingNote(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsUploading(true);
    try {
      const formData = new FormData();
      for (let i = 0; i < files.length; i++) {
        formData.append('files', files[i]);
      }

      const response = await apiClient.post<{ files: Attachment[] }>('/uploads/', formData);
      const newAttachments = response.files || [];
      setAttachments((prev) => [...prev, ...newAttachments]);

      // Save attachments to project
      await apiClient.patch(`/projects/${projectId}`, {
        attachments: JSON.stringify([...attachments, ...newAttachments]),
      });

      toast.success('Files uploaded');
    } catch {
      toast.error('Failed to upload files');
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'active':
        return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case 'completed':
        return <CheckCircle2 className="h-4 w-4 text-green-600" />;
      case 'on_hold':
        return <AlertCircle className="h-4 w-4 text-yellow-500" />;
      default:
        return <Clock className="h-4 w-4 text-blue-500" />;
    }
  };

  const getTaskStatusColor = (status: string) => {
    switch (status) {
      case 'done':
        return 'bg-green-500/10 text-green-500';
      case 'in_progress':
        return 'bg-blue-500/10 text-blue-500';
      case 'in_review':
        return 'bg-yellow-500/10 text-yellow-500';
      default:
        return 'bg-gray-500/10 text-gray-500';
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-text-quaternary dark:text-text-dark-quaternary" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="rounded-xl border border-border p-6 text-center dark:border-border-dark">
        <p className="text-sm text-text-tertiary dark:text-text-dark-tertiary">Project not found</p>
        <Button variant="outline" size="sm" onClick={() => navigate('/settings')} className="mt-4">
          <ArrowLeft className="h-3.5 w-3.5 mr-1" />
          Back to Settings
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate('/settings')}
            className="mt-0.5"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-surface-tertiary dark:bg-surface-dark-tertiary text-text-quaternary dark:text-text-dark-quaternary">
                {project.key}
              </span>
              <h2 className="text-sm font-medium text-text-primary dark:text-text-dark-primary">
                {project.name}
              </h2>
            </div>
            <div className="flex items-center gap-2 mt-1">
              {getStatusIcon(project.status)}
              <span className="text-xs capitalize text-text-secondary dark:text-text-dark-secondary">
                {project.status.replace('_', ' ')}
              </span>
            </div>
          </div>
        </div>
        {project.budget && (
          <div className="text-right">
            <p className="text-xs text-text-tertiary dark:text-text-dark-tertiary">Budget</p>
            <p className="text-sm font-medium text-text-primary dark:text-text-dark-primary">
              ${project.budget.toLocaleString()}
            </p>
          </div>
        )}
      </div>

      {/* Description */}
      {project.description && (
        <div className="rounded-xl border border-border p-4 dark:border-border-dark">
          <h3 className="text-xs font-medium text-text-secondary dark:text-text-dark-secondary mb-2">
            Description
          </h3>
          <p className="text-xs text-text-primary dark:text-text-dark-primary whitespace-pre-wrap">
            {project.description}
          </p>
        </div>
      )}

      {/* Tasks */}
      <div className="rounded-xl border border-border p-4 dark:border-border-dark">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-medium text-text-secondary dark:text-text-dark-secondary">
            Tasks ({tasks.length})
          </h3>
          <Button variant="outline" size="sm">
            <Plus className="h-3.5 w-3.5 mr-1" />
            Add Task
          </Button>
        </div>

        {tasks.length === 0 ? (
          <p className="text-xs text-text-quaternary dark:text-text-dark-quaternary text-center py-4">
            No tasks yet
          </p>
        ) : (
          <div className="space-y-2">
            {tasks.map((task) => (
              <div
                key={task.id}
                className="flex items-center justify-between p-2 rounded-lg bg-surface-secondary dark:bg-surface-dark-secondary"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-text-primary dark:text-text-dark-primary truncate">
                    {task.title}
                  </p>
                  {task.due_date && (
                    <p className="text-2xs text-text-quaternary dark:text-text-dark-quaternary">
                      Due: {new Date(task.due_date).toLocaleDateString()}
                    </p>
                  )}
                </div>
                <span className={cn('px-2 py-0.5 rounded text-2xs capitalize', getTaskStatusColor(task.status))}>
                  {task.status.replace('_', ' ')}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Notes */}
      <div className="rounded-xl border border-border p-4 dark:border-border-dark">
        <h3 className="text-xs font-medium text-text-secondary dark:text-text-dark-secondary mb-3">
          Notes
        </h3>

        <div className="space-y-3 mb-3">
          {notes.map((note) => (
            <div key={note.id} className="p-2 rounded-lg bg-surface-secondary dark:bg-surface-dark-secondary">
              <p className="text-xs text-text-primary dark:text-text-dark-primary whitespace-pre-wrap">
                {note.content}
              </p>
              <p className="text-2xs text-text-quaternary dark:text-text-dark-quaternary mt-1">
                {note.author_name} • {new Date(note.created_at).toLocaleString()}
              </p>
            </div>
          ))}
        </div>

        <div className="flex gap-2">
          <Textarea
            value={newNote}
            onChange={(e) => setNewNote(e.target.value)}
            placeholder="Add a note..."
            rows={2}
            className="flex-1"
          />
          <Button
            size="sm"
            onClick={handleAddNote}
            isLoading={isAddingNote}
            disabled={!newNote.trim()}
          >
            Add
          </Button>
        </div>
      </div>

      {/* Attachments */}
      <div className="rounded-xl border border-border p-4 dark:border-border-dark">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-medium text-text-secondary dark:text-text-dark-secondary">
            Attachments ({attachments.length})
          </h3>
          <div>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              onChange={handleFileUpload}
              className="hidden"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              isLoading={isUploading}
            >
              <Upload className="h-3.5 w-3.5 mr-1" />
              Upload
            </Button>
          </div>
        </div>

        {attachments.length === 0 ? (
          <p className="text-xs text-text-quaternary dark:text-text-dark-quaternary text-center py-4">
            No attachments yet
          </p>
        ) : (
          <div className="space-y-2">
            {attachments.map((file, index) => (
              <div
                key={index}
                className="flex items-center justify-between p-2 rounded-lg bg-surface-secondary dark:bg-surface-dark-secondary"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-text-primary dark:text-text-dark-primary truncate">
                    {file.name}
                  </p>
                  <p className="text-2xs text-text-quaternary dark:text-text-dark-quaternary">
                    {formatFileSize(file.size)}
                  </p>
                </div>
                <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
                  <Trash2 className="h-3.5 w-3.5 text-red-500" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
