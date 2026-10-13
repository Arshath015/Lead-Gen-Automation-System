import { useState } from "react";
import { useListAuditLogs } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { format, parseISO } from "date-fns";
import { Loader2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";

const ACTION_LABELS: Record<string, string> = {
  create: "Create",
  update: "Update",
  delete: "Delete",
  assign: "Assign",
  stage_change: "Stage Change",
  import: "Import",
};

export default function Audit() {
  const [page, setPage] = useState(1);
  const [action, setAction] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const hasFilters = action !== "all" || !!dateFrom || !!dateTo;

  const { data, isLoading } = useListAuditLogs({
    page,
    limit: 50,
    action: action !== "all" ? action : undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
  } as any);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Audit Log</h1>
        <p className="text-muted-foreground">System-wide activity tracking for compliance and debugging.</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select value={action} onValueChange={(v) => { setAction(v); setPage(1); }}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="All Actions" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Actions</SelectItem>
            {Object.entries(ACTION_LABELS).map(([v, l]) => (
              <SelectItem key={v} value={v}>{l}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <input
          type="date"
          value={dateFrom}
          onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
          className="h-9 rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          title="From date"
        />
        <span className="text-muted-foreground text-xs">to</span>
        <input
          type="date"
          value={dateTo}
          onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
          className="h-9 rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          title="To date"
        />
        {hasFilters && (
          <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground" onClick={() => { setAction("all"); setDateFrom(""); setDateTo(""); setPage(1); }}>
            <X className="h-3.5 w-3.5" /> Clear
          </Button>
        )}
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[160px]">Timestamp</TableHead>
                <TableHead>User</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Resource</TableHead>
                <TableHead>IP Address</TableHead>
                <TableHead>Change</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-32 text-center">
                    <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
                  </TableCell>
                </TableRow>
              ) : data?.logs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-32 text-center text-muted-foreground">
                    No audit logs found.
                  </TableCell>
                </TableRow>
              ) : (
                data?.logs.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell className="text-sm whitespace-nowrap text-muted-foreground">
                      {format(parseISO(log.createdAt), "MMM d, yyyy HH:mm")}
                    </TableCell>
                    <TableCell className="font-medium text-sm">
                      {log.userName || "System"}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="font-mono text-xs capitalize">
                        {ACTION_LABELS[log.action] ?? log.action}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">
                      {log.tableName} {log.leadCompanyName ? `— ${log.leadCompanyName}` : ""}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground font-mono">
                      {(log as any).ipAddress || "—"}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground max-w-xs">
                      {log.fieldName && (
                        <span>
                          <span className="font-medium text-foreground">{log.fieldName}</span>:{" "}
                          <span className="line-through opacity-60">{log.oldValue || "—"}</span>
                          {" → "}
                          <span className="text-foreground">{log.newValue || "—"}</span>
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {data && data.total > 50 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>Showing {Math.min(page * 50, data.total)} of {data.total} entries</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Previous</Button>
            <Button variant="outline" size="sm" disabled={page * 50 >= data.total} onClick={() => setPage(p => p + 1)}>Next</Button>
          </div>
        </div>
      )}
    </div>
  );
}
