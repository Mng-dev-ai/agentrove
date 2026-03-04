import { useState, useEffect, useCallback } from 'react';
import { Users, Plus, Trash2, Shield, User as UserIcon, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button';
import { Input } from '@/components/ui/primitives/Input';
import { Spinner } from '@/components/ui/primitives/Spinner';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import toast from 'react-hot-toast';
import { apiClient } from '@/lib/api';
import type { AdminUser, AdminUserCreate, AdminUserUpdate } from '@/types/user.types';

export function UsersSection() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null);
  const [createForm, setCreateForm] = useState<AdminUserCreate>({
    email: '',
    username: '',
    password: '',
    is_superuser: false,
  });
  const [createLoading, setCreateLoading] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const fetchUsers = useCallback(async () => {
    try {
      const response = await apiClient.get<AdminUser[]>('/auth/admin/users');
      setUsers(response);
    } catch (error) {
      console.error('Failed to fetch users:', error);
      toast.error('Failed to load users');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const handleCreateUser = async () => {
    if (!createForm.email || !createForm.username || !createForm.password) {
      toast.error('All fields are required');
      return;
    }

    setCreateLoading(true);
    try {
      await apiClient.post<AdminUser>('/auth/admin/users', createForm);
      toast.success('User created successfully');
      setShowCreateDialog(false);
      setCreateForm({ email: '', username: '', password: '', is_superuser: false });
      fetchUsers();
    } catch {
      toast.error('Failed to create user');
    } finally {
      setCreateLoading(false);
    }
  };

  const handleToggleAdmin = async (user: AdminUser) => {
    try {
      const update: AdminUserUpdate = { is_superuser: !user.is_superuser };
      await apiClient.patch<AdminUser>(`/auth/admin/users/${user.id}`, update);
      toast.success(user.is_superuser ? 'Admin role removed' : 'Admin role granted');
      fetchUsers();
    } catch {
      toast.error('Failed to update user');
    }
  };

  const handleToggleActive = async (user: AdminUser) => {
    try {
      const update: AdminUserUpdate = { is_active: !user.is_active };
      await apiClient.patch<AdminUser>(`/auth/admin/users/${user.id}`, update);
      toast.success(user.is_active ? 'User deactivated' : 'User activated');
      fetchUsers();
    } catch {
      toast.error('Failed to update user');
    }
  };

  const handleDeleteUser = async () => {
    if (!selectedUser) return;

    setDeleteLoading(true);
    try {
      await apiClient.delete(`/auth/admin/users/${selectedUser.id}`);
      toast.success('User deleted successfully');
      setShowDeleteDialog(false);
      setSelectedUser(null);
      fetchUsers();
    } catch {
      toast.error('Failed to delete user');
    } finally {
      setDeleteLoading(false);
    }
  };

  const openDeleteDialog = (user: AdminUser) => {
    setSelectedUser(user);
    setShowDeleteDialog(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-medium text-text-primary dark:text-text-dark-primary">
            User Management
          </h2>
          <p className="mt-1 text-xs text-text-tertiary dark:text-text-dark-tertiary">
            Manage users and their permissions
          </p>
        </div>
        <Button size="sm" onClick={() => setShowCreateDialog(true)}>
          <Plus className="mr-1.5 h-3 w-3" />
          Add User
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Spinner size="md" className="text-text-quaternary dark:text-text-dark-quaternary" />
        </div>
      ) : users.length === 0 ? (
        <div className="rounded-xl border border-border p-8 text-center dark:border-border-dark">
          <Users className="mx-auto h-8 w-8 text-text-quaternary dark:text-text-dark-quaternary" />
          <p className="mt-2 text-xs text-text-tertiary dark:text-text-dark-tertiary">
            No users found
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {users.map((user) => (
            <div
              key={user.id}
              className="flex items-center justify-between rounded-xl border border-border p-4 dark:border-border-dark"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-surface-tertiary dark:bg-surface-dark-tertiary">
                  {user.is_superuser ? (
                    <ShieldCheck className="h-4 w-4 text-text-secondary dark:text-text-dark-secondary" />
                  ) : (
                    <UserIcon className="h-4 w-4 text-text-secondary dark:text-text-dark-secondary" />
                  )}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-text-primary dark:text-text-dark-primary">
                      {user.username}
                    </span>
                    {user.is_superuser && (
                      <span className="rounded bg-surface-tertiary px-1.5 py-0.5 text-2xs font-medium text-text-tertiary dark:bg-surface-dark-tertiary dark:text-text-dark-tertiary">
                        Admin
                      </span>
                    )}
                    {!user.is_active && (
                      <span className="rounded bg-surface-tertiary px-1.5 py-0.5 text-2xs font-medium text-error">
                        Inactive
                      </span>
                    )}
                    {!user.is_verified && (
                      <span className="rounded bg-surface-tertiary px-1.5 py-0.5 text-2xs font-medium text-warning">
                        Unverified
                      </span>
                    )}
                  </div>
                  <span className="text-2xs text-text-tertiary dark:text-text-dark-tertiary">
                    {user.email}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => handleToggleAdmin(user)}
                  title={user.is_superuser ? 'Remove admin' : 'Make admin'}
                >
                  <Shield className={`h-3.5 w-3.5 ${user.is_superuser ? 'text-text-primary' : 'text-text-tertiary'}`} />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => handleToggleActive(user)}
                  title={user.is_active ? 'Deactivate' : 'Activate'}
                >
                  <span className={`text-2xs ${user.is_active ? 'text-text-tertiary' : 'text-success'}`}>
                    {user.is_active ? 'Disable' : 'Enable'}
                  </span>
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => openDeleteDialog(user)}
                  className="text-error hover:text-error"
                  title="Delete user"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create User Dialog */}
      {showCreateDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-xl border border-border bg-surface p-6 dark:border-border-dark dark:bg-surface-dark">
            <h3 className="text-sm font-medium text-text-primary dark:text-text-dark-primary">
              Create New User
            </h3>
            <div className="mt-4 space-y-3">
              <div>
                <label className="mb-1.5 block text-2xs text-text-secondary dark:text-text-dark-secondary">
                  Email
                </label>
                <Input
                  type="email"
                  value={createForm.email}
                  onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })}
                  placeholder="user@example.com"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-2xs text-text-secondary dark:text-text-dark-secondary">
                  Username
                </label>
                <Input
                  value={createForm.username}
                  onChange={(e) => setCreateForm({ ...createForm, username: e.target.value })}
                  placeholder="username"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-2xs text-text-secondary dark:text-text-dark-secondary">
                  Password
                </label>
                <Input
                  type="password"
                  value={createForm.password}
                  onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })}
                  placeholder="••••••••"
                />
              </div>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={createForm.is_superuser}
                  onChange={(e) => setCreateForm({ ...createForm, is_superuser: e.target.checked })}
                  className="rounded border-border dark:border-border-dark"
                />
                <span className="text-xs text-text-secondary dark:text-text-dark-secondary">
                  Admin user
                </span>
              </label>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setShowCreateDialog(false)}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleCreateUser}
                isLoading={createLoading}
              >
                Create User
              </Button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        isOpen={showDeleteDialog}
        onClose={() => {
          setShowDeleteDialog(false);
          setSelectedUser(null);
        }}
        onConfirm={handleDeleteUser}
        title="Delete User"
        message={`Are you sure you want to delete "${selectedUser?.username}"? This action cannot be undone.`}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        isLoading={deleteLoading}
      />
    </div>
  );
}
