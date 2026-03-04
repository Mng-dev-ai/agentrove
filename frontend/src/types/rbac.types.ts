export interface Permission {
  id: string;
  name: string;
  display_name: string;
  description: string | null;
  module: string;
  created_at: string;
}

export interface Role {
  id: string;
  name: string;
  display_name: string;
  description: string | null;
  is_system: boolean;
  created_at: string;
  updated_at: string;
}

export interface RoleWithPermissions extends Role {
  permissions: Permission[];
}

export interface RoleCreate {
  name: string;
  display_name: string;
  description?: string | null;
  permission_ids?: string[];
}

export interface RoleUpdate {
  name?: string;
  display_name?: string;
  description?: string | null;
  permission_ids?: string[];
}

export interface UserRoleAssign {
  role_id: string;
}

export interface UserWithRoles {
  id: string;
  email: string;
  username: string;
  first_name: string | null;
  last_name: string | null;
  display_name: string | null;
  is_active: boolean;
  is_verified: boolean;
  is_superuser: boolean;
  roles: Role[];
}
