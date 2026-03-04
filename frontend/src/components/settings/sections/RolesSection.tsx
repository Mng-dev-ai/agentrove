import { useState, useMemo } from 'react';
import { Shield, Plus, Trash2, Edit2, Check } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button';
import { Input } from '@/components/ui/primitives/Input';
import { Label } from '@/components/ui/primitives/Label';
import { Spinner } from '@/components/ui/primitives/Spinner';
import { Badge } from '@/components/ui/primitives/Badge';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import toast from 'react-hot-toast';
import { cn } from '@/utils/cn';
import {
  useRolesQuery,
  usePermissionsQuery,
  useCreateRoleMutation,
  useUpdateRoleMutation,
  useDeleteRoleMutation,
  useInitializeRbacMutation,
} from '@/hooks/queries/useRbacQueries';
import type { RoleWithPermissions, Permission } from '@/types/rbac.types';

function groupPermissionsByModule(permissions: Permission[]): Record<string, Permission[]> {
  return permissions.reduce((acc, perm) => {
    if (!acc[perm.module]) {
      acc[perm.module] = [];
    }
    acc[perm.module].push(perm);
    return acc;
  }, {} as Record<string, Permission[]>);
}

export function RolesSection() {
  const { data: roles, isLoading: rolesLoading } = useRolesQuery();
  const { data: permissions, isLoading: permissionsLoading } = usePermissionsQuery();
  const createRole = useCreateRoleMutation();
  const updateRole = useUpdateRoleMutation();
  const deleteRole = useDeleteRoleMutation();
  const initializeRbac = useInitializeRbacMutation();

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingRole, setEditingRole] = useState<RoleWithPermissions | null>(null);
  const [deleteRoleId, setDeleteRoleId] = useState<string | null>(null);

  const [formName, setFormName] = useState('');
  const [formDisplayName, setFormDisplayName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formPermissionIds, setFormPermissionIds] = useState<Set<string>>(new Set());

  const isLoading = rolesLoading || permissionsLoading;
  const permissionsByModule = useMemo(
    () => groupPermissionsByModule(permissions || []),
    [permissions]
  );

  const resetForm = () => {
    setFormName('');
    setFormDisplayName('');
    setFormDescription('');
    setFormPermissionIds(new Set());
    setShowCreateForm(false);
    setEditingRole(null);
  };

  const handleCreateClick = () => {
    resetForm();
    setShowCreateForm(true);
  };

  const handleEditClick = (role: RoleWithPermissions) => {
    setEditingRole(role);
    setFormName(role.name);
    setFormDisplayName(role.display_name);
    setFormDescription(role.description || '');
    setFormPermissionIds(new Set(role.permissions.map((p) => p.id)));
    setShowCreateForm(true);
  };

  const handlePermissionToggle = (permissionId: string) => {
    setFormPermissionIds((prev) => {
      const next = new Set(prev);
      if (next.has(permissionId)) {
        next.delete(permissionId);
      } else {
        next.add(permissionId);
      }
      return next;
    });
  };

  const handleSubmit = async () => {
    if (!formName.trim() || !formDisplayName.trim()) {
      toast.error('Name and display name are required');
      return;
    }

    const data = {
      name: formName.trim().toLowerCase().replace(/\s+/g, '_'),
      display_name: formDisplayName.trim(),
      description: formDescription.trim() || null,
      permission_ids: Array.from(formPermissionIds),
    };

    try {
      if (editingRole) {
        await updateRole.mutateAsync({ roleId: editingRole.id, data });
        toast.success('Role updated successfully');
      } else {
        await createRole.mutateAsync(data);
        toast.success('Role created successfully');
      }
      resetForm();
    } catch {
      toast.error(editingRole ? 'Failed to update role' : 'Failed to create role');
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteRoleId) return;
    try {
      await deleteRole.mutateAsync(deleteRoleId);
      toast.success('Role deleted successfully');
    } catch {
      toast.error('Failed to delete role');
    } finally {
      setDeleteRoleId(null);
    }
  };

  const handleInitialize = async () => {
    try {
      await initializeRbac.mutateAsync();
      toast.success('RBAC initialized successfully');
    } catch {
      toast.error('Failed to initialize RBAC');
    }
  };

  if (isLoading) {
    return (
      <div className="rounded-xl border border-border p-5 dark:border-border-dark">
        <div className="flex items-center justify-center py-8">
          <Spinner size="md" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-sm font-medium text-text-primary dark:text-text-dark-primary">
            Roles & Permissions
          </h2>
          <p className="mt-1 text-xs text-text-tertiary dark:text-text-dark-tertiary">
            Manage roles and their permissions for access control
          </p>
        </div>
        <div className="flex gap-2">
          {roles?.length === 0 && (
            <Button variant="outline" size="sm" onClick={handleInitialize}>
              Initialize Defaults
            </Button>
          )}
          <Button variant="primary" size="sm" onClick={handleCreateClick}>
            <Plus className="h-3.5 w-3.5" />
            Create Role
          </Button>
        </div>
      </div>

      {showCreateForm && (
        <div className="rounded-xl border border-border p-4 dark:border-border-dark">
          <div className="mb-4 flex items-center gap-2">
            <Shield className="h-4 w-4 text-text-secondary dark:text-text-dark-secondary" />
            <h3 className="text-xs font-medium text-text-primary dark:text-text-dark-primary">
              {editingRole ? 'Edit Role' : 'Create New Role'}
            </h3>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label className="mb-1.5 text-2xs text-text-secondary dark:text-text-dark-secondary">
                Role Name
              </Label>
              <Input
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="e.g., project_manager"
                disabled={editingRole?.is_system}
              />
            </div>
            <div>
              <Label className="mb-1.5 text-2xs text-text-secondary dark:text-text-dark-secondary">
                Display Name
              </Label>
              <Input
                value={formDisplayName}
                onChange={(e) => setFormDisplayName(e.target.value)}
                placeholder="e.g., Project Manager"
              />
            </div>
          </div>

          <div className="mt-3">
            <Label className="mb-1.5 text-2xs text-text-secondary dark:text-text-dark-secondary">
              Description
            </Label>
            <Input
              value={formDescription}
              onChange={(e) => setFormDescription(e.target.value)}
              placeholder="Brief description of the role"
            />
          </div>

          <div className="mt-4">
            <Label className="mb-2 text-2xs text-text-secondary dark:text-text-dark-secondary">
              Permissions
            </Label>
            <div className="max-h-64 space-y-3 overflow-y-auto rounded-lg border border-border p-3 dark:border-border-dark">
              {Object.entries(permissionsByModule).map(([module, perms]) => (
                <div key={module}>
                  <p className="mb-1.5 text-2xs font-medium uppercase tracking-wider text-text-quaternary dark:text-text-dark-quaternary">
                    {module}
                  </p>
                  <div className="grid grid-cols-2 gap-1.5">
                    {perms.map((perm) => (
                      <button
                        key={perm.id}
                        type="button"
                        onClick={() => handlePermissionToggle(perm.id)}
                        className={cn(
                          'flex items-center gap-1.5 rounded px-2 py-1 text-left text-xs transition-colors',
                          formPermissionIds.has(perm.id)
                            ? 'bg-surface-active text-text-primary dark:bg-surface-dark-active dark:text-text-dark-primary'
                            : 'bg-surface-tertiary text-text-tertiary hover:bg-surface-hover dark:bg-surface-dark-tertiary dark:text-text-dark-tertiary dark:hover:bg-surface-dark-hover'
                        )}
                      >
                        {formPermissionIds.has(perm.id) ? (
                          <Check className="h-3 w-3" />
                        ) : (
                          <div className="h-3 w-3 rounded border border-border dark:border-border-dark" />
                        )}
                        {perm.display_name}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-4 flex gap-2">
            <Button
              size="sm"
              onClick={handleSubmit}
              isLoading={createRole.isPending || updateRole.isPending}
            >
              {editingRole ? 'Update Role' : 'Create Role'}
            </Button>
            <Button size="sm" variant="ghost" onClick={resetForm}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {roles?.map((role) => (
          <div
            key={role.id}
            className="rounded-xl border border-border p-4 dark:border-border-dark"
          >
            <div className="flex items-start justify-between">
              <div className="flex items-start gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-surface-tertiary dark:bg-surface-dark-tertiary">
                  <Shield className="h-4 w-4 text-text-secondary dark:text-text-dark-secondary" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-xs font-medium text-text-primary dark:text-text-dark-primary">
                      {role.display_name}
                    </h3>
                    {role.is_system && (
                      <Badge variant="secondary" className="text-2xs">
                        System
                      </Badge>
                    )}
                  </div>
                  <p className="font-mono text-2xs text-text-quaternary dark:text-text-dark-quaternary">
                    {role.name}
                  </p>
                  {role.description && (
                    <p className="mt-1 text-2xs text-text-tertiary dark:text-text-dark-tertiary">
                      {role.description}
                    </p>
                  )}
                  <div className="mt-2 flex flex-wrap gap-1">
                    {role.permissions.slice(0, 5).map((perm) => (
                      <Badge key={perm.id} variant="outline" className="text-2xs">
                        {perm.display_name}
                      </Badge>
                    ))}
                    {role.permissions.length > 5 && (
                      <Badge variant="outline" className="text-2xs">
                        +{role.permissions.length - 5} more
                      </Badge>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleEditClick(role)}
                >
                  <Edit2 className="h-3.5 w-3.5" />
                </Button>
                {!role.is_system && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setDeleteRoleId(role.id)}
                    className="text-text-tertiary hover:text-red-500 dark:text-text-dark-tertiary dark:hover:text-red-400"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            </div>
          </div>
        ))}

        {roles?.length === 0 && !showCreateForm && (
          <div className="rounded-xl border border-border p-8 text-center dark:border-border-dark">
            <Shield className="mx-auto h-8 w-8 text-text-quaternary dark:text-text-dark-quaternary" />
            <p className="mt-2 text-xs text-text-tertiary dark:text-text-dark-tertiary">
              No roles configured yet
            </p>
            <p className="mt-1 text-2xs text-text-quaternary dark:text-text-dark-quaternary">
              Initialize default roles or create custom ones
            </p>
          </div>
        )}
      </div>

      <ConfirmDialog
        isOpen={!!deleteRoleId}
        onClose={() => setDeleteRoleId(null)}
        onConfirm={handleDeleteConfirm}
        title="Delete Role"
        message="Are you sure you want to delete this role? This action cannot be undone."
        confirmLabel="Delete"
        cancelLabel="Cancel"
      />
    </div>
  );
}
