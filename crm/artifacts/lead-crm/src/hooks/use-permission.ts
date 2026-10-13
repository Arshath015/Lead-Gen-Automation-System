import { useAuth } from "@workspace/replit-auth-web";

export function usePermission(permission: string): boolean {
  const { user } = useAuth();
  if (!user) return false;
  if (user.isSuperAdmin) return true;
  return user.permissions?.includes(permission) ?? false;
}

export function usePermissions() {
  const { user } = useAuth();
  const permissions = user?.permissions ?? [];
  const isSuperAdmin = user?.isSuperAdmin ?? false;

  return {
    permissions,
    isSuperAdmin,
    has: (permission: string) => isSuperAdmin || permissions.includes(permission),
    hasAny: (perms: string[]) => isSuperAdmin || perms.some(p => permissions.includes(p)),
    hasAll: (perms: string[]) => isSuperAdmin || perms.every(p => permissions.includes(p)),
  };
}
