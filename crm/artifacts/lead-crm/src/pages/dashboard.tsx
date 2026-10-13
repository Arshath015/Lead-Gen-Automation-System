import { useAuth } from "@workspace/replit-auth-web";
import { Redirect } from "wouter";
import AdminDashboard from "./dashboard/admin-dashboard";
import ManagerDashboard from "./dashboard/manager-dashboard";
import BDDashboard from "./dashboard/bd-dashboard";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { usePermissions } from "@/hooks/use-permission";

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      {/* Stat cards row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-4 rounded" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-7 w-16 mb-1" />
              <Skeleton className="h-3 w-32" />
            </CardContent>
          </Card>
        ))}
      </div>
      {/* Chart placeholders */}
      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardHeader><Skeleton className="h-5 w-36" /></CardHeader>
          <CardContent><Skeleton className="h-48 w-full rounded" /></CardContent>
        </Card>
        <Card>
          <CardHeader><Skeleton className="h-5 w-36" /></CardHeader>
          <CardContent><Skeleton className="h-48 w-full rounded" /></CardContent>
        </Card>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { user, isLoading } = useAuth();
  const { has } = usePermissions();

  if (isLoading) {
    return <DashboardSkeleton />;
  }

  // ProtectedRoute guarantees user is non-null here, but guard defensively so
  // a future auth regression produces a skeleton rather than a white screen.
  if (!user) {
    console.error("[Dashboard] Rendered without authenticated user — this is a bug in the auth/routing layer.");
    return <DashboardSkeleton />;
  }

  // Gate on the RBAC permission, not the legacy role enum column.
  // The legacy user.role can be out of sync with the actual role_id (e.g. a Finance
  // user whose legacy enum column still reads "admin"). Any role that lacks
  // dashboard.view should land on their real entry point (/deals) instead.
  if (!has("dashboard.view")) return <Redirect to="/deals" />;

  // Legacy enum is still reliable for admin/manager/bd — they have matching enums.
  const role = user.role ?? "bd";
  if (role === "admin") return <AdminDashboard />;
  if (role === "manager") return <ManagerDashboard />;
  return <BDDashboard />;
}
