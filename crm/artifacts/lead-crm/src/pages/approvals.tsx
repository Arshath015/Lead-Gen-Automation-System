import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle, XCircle, UserCheck, UserX, RefreshCw } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type AccountStatus = "pending" | "active" | "rejected" | "disabled";

interface ApprovalUser {
  id: number;
  email: string | null;
  fullName: string;
  company: string | null;
  requestedRole: string | null;
  role: string;
  accountStatus: AccountStatus;
  rejectionReason: string | null;
  createdAt: string;
}

const STATUS_LABELS: Record<AccountStatus, string> = {
  pending: "Pending",
  active: "Active",
  rejected: "Rejected",
  disabled: "Disabled",
};

const STATUS_COLORS: Record<AccountStatus, string> = {
  pending: "bg-yellow-100 text-yellow-800 border-yellow-200",
  active: "bg-green-100 text-green-800 border-green-200",
  rejected: "bg-red-100 text-red-800 border-red-200",
  disabled: "bg-gray-100 text-gray-600 border-gray-200",
};

const ROLE_LABELS: Record<string, string> = {
  admin: "Admin",
  manager: "Sales Manager",
  bd: "Sales Person",
};

async function apiFetch(path: string, options?: RequestInit) {
  const res = await fetch(`${BASE}/api${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) throw new Error((await res.json()).error ?? "Request failed");
  return res.json();
}

export default function Approvals() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [filter, setFilter] = useState<string>("pending");

  const [approveUser, setApproveUser] = useState<ApprovalUser | null>(null);
  const [approveRole, setApproveRole] = useState<"admin" | "manager" | "bd">("bd");

  const [rejectUser, setRejectUser] = useState<ApprovalUser | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const { data: users = [], isLoading, refetch } = useQuery<ApprovalUser[]>({
    queryKey: ["approvals", filter],
    queryFn: () => apiFetch(`/approvals?status=${filter}`),
  });

  const approveMutation = useMutation({
    mutationFn: (vars: { id: number; role: string }) =>
      apiFetch(`/approvals/${vars.id}/approve`, {
        method: "POST",
        body: JSON.stringify({ role: vars.role }),
      }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["approvals"] });
      setApproveUser(null);
      toast({ title: "Account approved", description: `User has been approved as ${ROLE_LABELS[vars.role]}.` });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const rejectMutation = useMutation({
    mutationFn: (vars: { id: number; reason: string }) =>
      apiFetch(`/approvals/${vars.id}/reject`, {
        method: "POST",
        body: JSON.stringify({ reason: vars.reason }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["approvals"] });
      setRejectUser(null);
      setRejectReason("");
      toast({ title: "Account rejected" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const disableMutation = useMutation({
    mutationFn: (id: number) =>
      apiFetch(`/approvals/${id}/disable`, { method: "POST", body: "{}" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["approvals"] });
      toast({ title: "Account disabled" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const enableMutation = useMutation({
    mutationFn: (id: number) =>
      apiFetch(`/approvals/${id}/enable`, { method: "POST", body: "{}" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["approvals"] });
      toast({ title: "Account re-enabled" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-primary">Account Approvals</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Review and manage user account requests</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
              <SelectItem value="disabled">Disabled</SelectItem>
              <SelectItem value="all">All users</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="icon" onClick={() => refetch()} title="Refresh">
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">Loading…</div>
      ) : users.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-40 text-muted-foreground">
          <UserCheck className="h-10 w-10 mb-3 opacity-30" />
          <p className="text-sm">No {filter === "all" ? "" : filter + " "}accounts found</p>
        </div>
      ) : (
        <div className="space-y-3">
          {users.map(user => (
            <div key={user.id} className="bg-card border rounded-xl p-4 flex flex-col sm:flex-row sm:items-center gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  <span className="font-semibold truncate">{user.fullName}</span>
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${STATUS_COLORS[user.accountStatus]}`}>
                    {STATUS_LABELS[user.accountStatus]}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground truncate">{user.email}</p>
                <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1 text-xs text-muted-foreground">
                  {user.company && <span>Company: {user.company}</span>}
                  <span>Requested: {ROLE_LABELS[user.requestedRole ?? "bd"] ?? user.requestedRole}</span>
                  {user.accountStatus !== "pending" && <span>Role: {ROLE_LABELS[user.role] ?? user.role}</span>}
                  <span>Signed up: {new Date(user.createdAt).toLocaleDateString()}</span>
                  {user.rejectionReason && <span className="text-red-600">Reason: {user.rejectionReason}</span>}
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {user.accountStatus === "pending" && (
                  <>
                    <Button
                      size="sm"
                      className="bg-green-600 hover:bg-green-700 text-white"
                      onClick={() => { setApproveUser(user); setApproveRole(user.requestedRole === "manager" ? "manager" : "bd"); }}
                    >
                      <CheckCircle className="h-4 w-4 mr-1.5" /> Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-red-300 text-red-600 hover:bg-red-50"
                      onClick={() => { setRejectUser(user); setRejectReason(""); }}
                    >
                      <XCircle className="h-4 w-4 mr-1.5" /> Reject
                    </Button>
                  </>
                )}
                {user.accountStatus === "active" && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-orange-600 border-orange-300 hover:bg-orange-50"
                    onClick={() => disableMutation.mutate(user.id)}
                  >
                    <UserX className="h-4 w-4 mr-1.5" /> Disable
                  </Button>
                )}
                {(user.accountStatus === "disabled" || user.accountStatus === "rejected") && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-green-600 border-green-300 hover:bg-green-50"
                    onClick={() => enableMutation.mutate(user.id)}
                  >
                    <UserCheck className="h-4 w-4 mr-1.5" /> Re-enable
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Approve dialog */}
      <Dialog open={!!approveUser} onOpenChange={() => setApproveUser(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Approve Account</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              Approving <strong>{approveUser?.fullName}</strong> ({approveUser?.email})
            </p>
            <div className="space-y-1.5">
              <Label>Assign role</Label>
              <Select value={approveRole} onValueChange={v => setApproveRole(v as typeof approveRole)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="manager">Sales Manager</SelectItem>
                  <SelectItem value="bd">Sales Person</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setApproveUser(null)}>Cancel</Button>
            <Button
              className="bg-green-600 hover:bg-green-700 text-white"
              onClick={() => approveMutation.mutate({ id: approveUser!.id, role: approveRole })}
              disabled={approveMutation.isPending}
            >
              {approveMutation.isPending ? "Approving…" : "Approve"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject dialog */}
      <Dialog open={!!rejectUser} onOpenChange={() => setRejectUser(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Account</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              Rejecting <strong>{rejectUser?.fullName}</strong> ({rejectUser?.email})
            </p>
            <div className="space-y-1.5">
              <Label>Reason <span className="text-muted-foreground">(optional)</span></Label>
              <Textarea
                placeholder="e.g. Position not currently available"
                value={rejectReason}
                onChange={e => setRejectReason(e.target.value)}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectUser(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => rejectMutation.mutate({ id: rejectUser!.id, reason: rejectReason })}
              disabled={rejectMutation.isPending}
            >
              {rejectMutation.isPending ? "Rejecting…" : "Reject"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
