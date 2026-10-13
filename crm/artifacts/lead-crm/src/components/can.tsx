import type { ReactNode } from "react";
import { usePermissions } from "@/hooks/use-permission";

interface CanProps {
  permission?: string;
  any?: string[];
  all?: string[];
  fallback?: ReactNode;
  children: ReactNode;
}

export function Can({ permission, any: anyPerms, all: allPerms, fallback = null, children }: CanProps) {
  const { has, hasAny, hasAll } = usePermissions();

  let allowed = false;
  if (permission) allowed = has(permission);
  else if (anyPerms) allowed = hasAny(anyPerms);
  else if (allPerms) allowed = hasAll(allPerms);
  else allowed = true;

  return allowed ? <>{children}</> : <>{fallback}</>;
}
