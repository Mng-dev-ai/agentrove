import { useState, useEffect, useCallback } from 'react';
import { Plus, FolderKanban, Loader2, Clock, CheckCircle2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button';
import { NewProjectRequestDialog } from '@/components/settings/dialogs/NewProjectRequestDialog';
import { useCurrentUserQuery } from '@/hooks/queries/useAuthQueries';
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
  created_at: string;
}

interface ProjectRequest {
  id: string;
  name: string;
  description: string;
  budget: number | null;
  topics: string | null;
  status: string;
  rejection_reason: string | null;
  created_at: string;
}

export function ProjectsSection() {
  const [showNewRequest, setShowNewRequest] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectRequests, setProjectRequests] = useState<ProjectRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const { data: currentUser, isLoading: isUserLoading } = useCurrentUserQuery();
  const isSuperuser = currentUser?.is_superuser ?? false;

  const loadData = useCallback(async () => {
    if (!currentUser) return;

    setIsLoading(true);
    try {
      const [projectsRes, requestsRes] = await Promise.all([
        apiClient.get<{ items: Project[] }>('/projects/?page=1&per_page=20'),
        apiClient.get<{ items: ProjectRequest[] }>('/customer/project-requests/my'),
      ]);
      setProjects(projectsRes?.items || []);
      setProjectRequests(requestsRes?.items || []);
    } catch (err) {
      const error = err as Error & { status?: number };
      // Don't show toast for auth errors - they're expected if not logged in
      if (error.status !== 401 && error.status !== 403) {
        toast.error('Failed to load projects');
      }
    } finally {
      setIsLoading(false);
    }
  }, [currentUser]);

  useEffect(() => {
    if (isUserLoading) return;
    loadData();
  }, [isUserLoading, loadData, refreshKey]);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'active':
        return <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />;
      case 'planning':
        return <Clock className="h-3.5 w-3.5 text-blue-500" />;
      case 'completed':
        return <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />;
      case 'on_hold':
        return <AlertCircle className="h-3.5 w-3.5 text-yellow-500" />;
      case 'approved':
        return <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />;
      case 'rejected':
        return <AlertCircle className="h-3.5 w-3.5 text-red-500" />;
      case 'pending':
        return <Clock className="h-3.5 w-3.5 text-yellow-500" />;
      default:
        return <Clock className="h-3.5 w-3.5 text-gray-400" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active':
      case 'approved':
        return 'text-green-500';
      case 'completed':
        return 'text-green-600';
      case 'planning':
        return 'text-blue-500';
      case 'on_hold':
      case 'pending':
        return 'text-yellow-500';
      case 'rejected':
        return 'text-red-500';
      default:
        return 'text-gray-400';
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium text-text-primary dark:text-text-dark-primary">
            Projects
          </h3>
          <p className="mt-0.5 text-xs text-text-tertiary dark:text-text-dark-tertiary">
            Manage your projects and requests
          </p>
        </div>
        <Button size="sm" onClick={() => setShowNewRequest(true)}>
          <Plus className="h-3.5 w-3.5 mr-1" />
          New Project Request
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-text-quaternary dark:text-text-dark-quaternary" />
        </div>
      ) : (
        <>
          {/* Project Requests */}
          {projectRequests.length > 0 && (
            <div>
              <h4 className="text-xs font-medium text-text-secondary dark:text-text-dark-secondary mb-2">
                Pending Requests
              </h4>
              <div className="space-y-2">
                {projectRequests.map((request) => (
                  <div
                    key={request.id}
                    className={cn(
                      'rounded-lg border border-border p-3 dark:border-border-dark',
                      'hover:bg-surface-hover dark:hover:bg-surface-dark-hover transition-colors cursor-pointer'
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <h4 className="text-xs font-medium text-text-primary dark:text-text-dark-primary">
                          {request.name}
                        </h4>
                        <p className="mt-0.5 text-2xs text-text-tertiary dark:text-text-dark-tertiary line-clamp-1">
                          {request.description}
                        </p>
                      </div>
                      <div className={cn('flex items-center gap-1 capitalize text-xs', getStatusColor(request.status))}>
                        {getStatusIcon(request.status)}
                        {request.status}
                      </div>
                    </div>
                    <div className="mt-2 flex items-center gap-3 text-2xs text-text-quaternary dark:text-text-dark-quaternary">
                      {request.budget && <span>${request.budget.toLocaleString()}</span>}
                      {request.budget && <span>•</span>}
                      <span>{new Date(request.created_at).toLocaleDateString()}</span>
                    </div>
                    {request.status === 'rejected' && request.rejection_reason && (
                      <div className="mt-2 p-2 rounded bg-red-500/10 text-2xs text-red-500">
                        <strong>Rejection reason:</strong> {request.rejection_reason}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Active Projects */}
          {projects.length > 0 && (
            <div>
              <h4 className="text-xs font-medium text-text-secondary dark:text-text-dark-secondary mb-2">
                Active Projects
              </h4>
              <div className="space-y-2">
                {projects.map((project) => (
                  <div
                    key={project.id}
                    className={cn(
                      'rounded-lg border border-border p-3 dark:border-border-dark',
                      'hover:bg-surface-hover dark:hover:bg-surface-dark-hover transition-colors cursor-pointer'
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-2xs font-mono px-1.5 py-0.5 rounded bg-surface-tertiary dark:bg-surface-dark-tertiary text-text-quaternary dark:text-text-dark-quaternary">
                            {project.key}
                          </span>
                          <h4 className="text-xs font-medium text-text-primary dark:text-text-dark-primary">
                            {project.name}
                          </h4>
                        </div>
                        {project.description && (
                          <p className="mt-0.5 text-2xs text-text-tertiary dark:text-text-dark-tertiary line-clamp-1">
                            {project.description}
                          </p>
                        )}
                      </div>
                      <div className={cn('flex items-center gap-1 capitalize text-xs', getStatusColor(project.status))}>
                        {getStatusIcon(project.status)}
                        {project.status.replace('_', ' ')}
                      </div>
                    </div>
                    <div className="mt-2 flex items-center gap-3 text-2xs text-text-quaternary dark:text-text-dark-quaternary">
                      {project.budget && <span>${project.budget.toLocaleString()}</span>}
                      {project.budget && <span>•</span>}
                      {project.due_date && (
                        <>
                          <span>Due: {new Date(project.due_date).toLocaleDateString()}</span>
                          <span>•</span>
                        </>
                      )}
                      <span>{new Date(project.created_at).toLocaleDateString()}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Empty State */}
          {projects.length === 0 && projectRequests.length === 0 && (
            <div className="rounded-xl border border-border p-8 text-center dark:border-border-dark">
              <FolderKanban className="h-8 w-8 mx-auto mb-2 text-text-quaternary dark:text-text-dark-quaternary" />
              <p className="text-xs text-text-tertiary dark:text-text-dark-tertiary">
                No projects yet
              </p>
              <p className="mt-1 text-2xs text-text-quaternary dark:text-text-dark-quaternary">
                Submit a project request to get started
              </p>
            </div>
          )}
        </>
      )}

      <NewProjectRequestDialog
        isOpen={showNewRequest}
        onClose={() => setShowNewRequest(false)}
        onSuccess={() => setRefreshKey((k) => k + 1)}
      />
    </div>
  );
}
