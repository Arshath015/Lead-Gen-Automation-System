import { useState, useMemo, useEffect } from "react";
import {
  useListScheduledActivities,
  useCreateScheduledActivity,
  useUpdateScheduledActivity,
  useDeleteScheduledActivity,
  useCompleteScheduledActivity,
  getListScheduledActivitiesQueryKey,
  useListLeads,
  useListUsers,
  type ListScheduledActivitiesParams,
} from "@workspace/api-client-react";
import { useAuth } from "@workspace/replit-auth-web";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem } from "@/components/ui/command";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Plus, ChevronLeft, ChevronRight, MoreVertical, CheckCircle2, Phone, Video, CalendarDays, ClipboardList, AlertCircle, ChevronsUpDown, Check } from "lucide-react";
import { format, parseISO, startOfWeek, addDays, addWeeks, subWeeks, addMonths, subMonths, startOfMonth, endOfMonth, isSameDay, isSameMonth } from "date-fns";
import { cn } from "@/lib/utils";

type View = "day" | "week" | "month";
type ActivityType = "task" | "call" | "meeting" | "followup";
type ActivityStatus = "open" | "completed" | "overdue" | "cancelled";

const TYPE_ICON: Record<ActivityType, React.FC<any>> = {
  task: ClipboardList,
  call: Phone,
  meeting: Video,
  followup: CalendarDays,
};

const TYPE_COLOR: Record<ActivityType, string> = {
  task: "text-blue-500",
  call: "text-green-500",
  meeting: "text-purple-500",
  followup: "text-amber-500",
};

const PRIORITY_COLOR: Record<string, string> = {
  high: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  medium: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  low: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
};

const STATUS_COLOR: Record<ActivityStatus, string> = {
  open: "bg-blue-100 text-blue-700 dark:bg-blue-900/30",
  completed: "bg-green-100 text-green-700 dark:bg-green-900/30",
  overdue: "bg-red-100 text-red-700 dark:bg-red-900/30",
  cancelled: "bg-slate-100 text-slate-500 dark:bg-slate-800",
};

function TypeIcon({ type, className }: { type: ActivityType; className?: string }) {
  const Icon = TYPE_ICON[type] ?? ClipboardList;
  return <Icon className={`h-4 w-4 ${TYPE_COLOR[type]} ${className ?? ""}`} />;
}

interface Activity {
  id: number;
  type: ActivityType;
  subject: string;
  leadId: number | null;
  leadCompanyName: string | null;
  ownerId: number | null;
  ownerName: string | null;
  dueAt: string;
  priority: string;
  status: ActivityStatus;
  notes: string | null;
  completedAt: string | null;
}

interface FormState {
  type: ActivityType;
  subject: string;
  leadId: string;
  ownerId: string;
  dueAt: string;
  priority: string;
  notes: string;
}

function buildForm(initial: Activity | null, userId: number | undefined): FormState {
  if (initial) {
    return {
      type: initial.type,
      subject: initial.subject,
      leadId: initial.leadId ? String(initial.leadId) : "",
      ownerId: initial.ownerId ? String(initial.ownerId) : String(userId ?? ""),
      dueAt: format(parseISO(initial.dueAt), "yyyy-MM-dd'T'HH:mm"),
      priority: initial.priority,
      notes: initial.notes ?? "",
    };
  }
  return {
    type: "task",
    subject: "",
    leadId: "",
    ownerId: String(userId ?? ""),
    dueAt: format(new Date(), "yyyy-MM-dd'T'HH:mm"),
    priority: "medium",
    notes: "",
  };
}

function ActivityCard({ activity, onEdit, onComplete, onDelete, compact }: {
  activity: Activity;
  onEdit: (a: Activity) => void;
  onComplete: (id: number) => void;
  onDelete: (id: number) => void;
  compact?: boolean;
}) {
  const isOverdue = activity.status === "overdue";
  const isCompleted = activity.status === "completed";

  return (
    <div className={`flex items-start gap-3 p-3 rounded-lg border transition-colors
      ${isOverdue ? "border-red-300 bg-red-50/50 dark:bg-red-950/20 dark:border-red-800" : "bg-card border-border hover:bg-muted/30"}
      ${isCompleted ? "opacity-60" : ""}`}
    >
      <button
        className="mt-0.5 shrink-0"
        onClick={() => !isCompleted && onComplete(activity.id)}
        title={isCompleted ? "Completed" : "Mark complete"}
      >
        {isCompleted
          ? <CheckCircle2 className="h-5 w-5 text-green-500" />
          : isOverdue
          ? <AlertCircle className="h-5 w-5 text-red-500 hover:text-red-600" />
          : <div className="h-5 w-5 rounded-full border-2 border-muted-foreground hover:border-primary transition-colors" />
        }
      </button>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <TypeIcon type={activity.type} />
          <span className={`text-sm font-medium ${isCompleted ? "line-through text-muted-foreground" : ""}`}>
            {activity.subject}
          </span>
          <Badge className={`text-[10px] h-4 px-1.5 border-0 font-medium ${PRIORITY_COLOR[activity.priority]}`}>
            {activity.priority}
          </Badge>
          {(isOverdue || isCompleted) && (
            <Badge className={`text-[10px] h-4 px-1.5 border-0 ${STATUS_COLOR[activity.status]}`}>
              {activity.status}
            </Badge>
          )}
        </div>
        {!compact && (
          <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
            <span>{format(parseISO(activity.dueAt), "h:mm a")}</span>
            {activity.leadCompanyName && (
              <span className="truncate max-w-[150px]">📋 {activity.leadCompanyName}</span>
            )}
            {activity.ownerName && <span>👤 {activity.ownerName}</span>}
          </div>
        )}
        {!compact && activity.notes && (
          <p className="text-xs text-muted-foreground mt-1 truncate">{activity.notes}</p>
        )}
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0">
            <MoreVertical className="h-3.5 w-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => onEdit(activity)}>Edit</DropdownMenuItem>
          {activity.status !== "completed" && (
            <DropdownMenuItem onClick={() => onComplete(activity.id)}>Mark Complete</DropdownMenuItem>
          )}
          <DropdownMenuItem className="text-destructive" onClick={() => onDelete(activity.id)}>Delete</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function DayView({ activities, selectedDate, onEdit, onComplete, onDelete, onNew }: {
  activities: Activity[];
  selectedDate: Date;
  onEdit: (a: Activity) => void;
  onComplete: (id: number) => void;
  onDelete: (id: number) => void;
  onNew: (date?: Date) => void;
}) {
  const sorted = [...activities].sort((a, b) => parseISO(a.dueAt).getTime() - parseISO(b.dueAt).getTime());

  return (
    <div className="space-y-2">
      {sorted.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 border-2 border-dashed rounded-xl text-center">
          <CalendarDays className="h-10 w-10 text-muted-foreground mb-3" />
          <p className="text-muted-foreground font-medium">No activities for {format(selectedDate, "EEEE, MMM d")}</p>
          <p className="text-sm text-muted-foreground mt-1">Create one to get started.</p>
          <Button variant="cta" size="sm" className="mt-4" onClick={() => onNew(selectedDate)}>
            <Plus className="h-4 w-4 mr-1.5" /> Add Activity
          </Button>
        </div>
      ) : (
        sorted.map(a => (
          <ActivityCard key={a.id} activity={a} onEdit={onEdit} onComplete={onComplete} onDelete={onDelete} />
        ))
      )}
    </div>
  );
}

function WeekView({ activities, weekStart, onEdit, onComplete, onDelete, onNew }: {
  activities: Activity[];
  weekStart: Date;
  onEdit: (a: Activity) => void;
  onComplete: (id: number) => void;
  onDelete: (id: number) => void;
  onNew: (date?: Date) => void;
}) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  return (
    <div className="grid grid-cols-7 gap-2">
      {days.map(day => {
        const dayActivities = activities
          .filter(a => isSameDay(parseISO(a.dueAt), day))
          .sort((a, b) => parseISO(a.dueAt).getTime() - parseISO(b.dueAt).getTime());
        const isToday = isSameDay(day, new Date());

        return (
          <div key={day.toISOString()} className="min-h-[200px]">
            <div className={`text-center py-2 mb-2 rounded-lg text-sm font-medium ${isToday ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
              <div className="text-[10px] uppercase tracking-wider">{format(day, "EEE")}</div>
              <div className={`text-lg font-bold ${isToday ? "" : "text-foreground"}`}>{format(day, "d")}</div>
            </div>
            <div className="space-y-1">
              {dayActivities.slice(0, 5).map(a => (
                <ActivityCard key={a.id} activity={a} onEdit={onEdit} onComplete={onComplete} onDelete={onDelete} compact />
              ))}
              {dayActivities.length > 5 && (
                <p className="text-[10px] text-muted-foreground text-center">+{dayActivities.length - 5} more</p>
              )}
            </div>
            <button
              className="w-full mt-2 text-[10px] text-muted-foreground hover:text-primary py-1 border border-dashed rounded opacity-50 hover:opacity-100 transition-opacity"
              onClick={() => onNew(day)}
            >
              + add
            </button>
          </div>
        );
      })}
    </div>
  );
}

function MonthView({ activities, selectedDate, onDayClick }: {
  activities: Activity[];
  selectedDate: Date;
  onDayClick: (d: Date) => void;
}) {
  const monthStart = startOfMonth(selectedDate);
  const monthEnd = endOfMonth(selectedDate);
  const calStart = startOfWeek(monthStart, { weekStartsOn: 1 });

  const weeks: Date[][] = [];
  let cur = calStart;
  while (cur <= monthEnd || weeks.length < 6) {
    const week: Date[] = [];
    for (let i = 0; i < 7; i++) {
      week.push(cur);
      cur = addDays(cur, 1);
    }
    weeks.push(week);
    if (cur > monthEnd && weeks.length >= 4) break;
  }

  const dotsByDay = useMemo(() => {
    const map: Record<string, { open: number; overdue: number; completed: number }> = {};
    activities.forEach(a => {
      const key = format(parseISO(a.dueAt), "yyyy-MM-dd");
      if (!map[key]) map[key] = { open: 0, overdue: 0, completed: 0 };
      if (a.status === "completed") map[key].completed++;
      else if (a.status === "overdue") map[key].overdue++;
      else map[key].open++;
    });
    return map;
  }, [activities]);

  return (
    <div>
      <div className="grid grid-cols-7 mb-1">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(d => (
          <div key={d} className="text-center text-xs font-medium text-muted-foreground py-2">{d}</div>
        ))}
      </div>
      <div className="space-y-1">
        {weeks.map((week, wi) => (
          <div key={wi} className="grid grid-cols-7 gap-1">
            {week.map(day => {
              const key = format(day, "yyyy-MM-dd");
              const dots = dotsByDay[key];
              const isToday = isSameDay(day, new Date());
              const isCurrentMonth = isSameMonth(day, selectedDate);
              const isSelected = isSameDay(day, selectedDate);

              return (
                <button
                  key={day.toISOString()}
                  onClick={() => onDayClick(day)}
                  className={`h-16 rounded-lg border text-left p-1.5 transition-colors hover:bg-muted/50
                    ${isSelected ? "border-primary bg-primary/5" : "border-border"}
                    ${!isCurrentMonth ? "opacity-40" : ""}`}
                >
                  <div className={`text-xs font-medium mb-1 w-6 h-6 rounded-full flex items-center justify-center
                    ${isToday ? "bg-primary text-primary-foreground" : "text-foreground"}`}>
                    {format(day, "d")}
                  </div>
                  {dots && (
                    <div className="flex gap-0.5 flex-wrap">
                      {Array.from({ length: Math.min(dots.overdue, 3) }).map((_, i) => (
                        <div key={`o${i}`} className="h-1.5 w-1.5 rounded-full bg-red-500" />
                      ))}
                      {Array.from({ length: Math.min(dots.open, 3) }).map((_, i) => (
                        <div key={`p${i}`} className="h-1.5 w-1.5 rounded-full bg-blue-500" />
                      ))}
                      {Array.from({ length: Math.min(dots.completed, 3) }).map((_, i) => (
                        <div key={`c${i}`} className="h-1.5 w-1.5 rounded-full bg-green-500" />
                      ))}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function LeadCombobox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const { data: leadsData } = useListLeads({ page: 1, limit: 100 });
  const leads: any[] = leadsData?.leads ?? [];

  const filtered = leads.filter(l =>
    l.companyName?.toLowerCase().includes(search.toLowerCase()) ||
    l.contactName?.toLowerCase().includes(search.toLowerCase())
  );

  const selected = leads.find(l => String(l.id) === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          className="w-full justify-between font-normal h-9 text-sm"
        >
          <span className="truncate">{selected ? selected.companyName : "No lead"}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-full p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search leads..."
            value={search}
            onValueChange={setSearch}
          />
          <CommandEmpty>No lead found.</CommandEmpty>
          <CommandGroup className="max-h-48 overflow-y-auto">
            <CommandItem
              value="none"
              onSelect={() => { onChange(""); setOpen(false); setSearch(""); }}
            >
              <Check className={cn("mr-2 h-4 w-4", !value ? "opacity-100" : "opacity-0")} />
              No lead
            </CommandItem>
            {filtered.slice(0, 30).map(l => (
              <CommandItem
                key={l.id}
                value={String(l.id)}
                onSelect={() => { onChange(String(l.id)); setOpen(false); setSearch(""); }}
              >
                <Check className={cn("mr-2 h-4 w-4", value === String(l.id) ? "opacity-100" : "opacity-0")} />
                {l.companyName}
                {l.contactName && <span className="ml-1 text-muted-foreground text-xs">· {l.contactName}</span>}
              </CommandItem>
            ))}
          </CommandGroup>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function ActivityDialog({ open, onClose, initial }: {
  open: boolean;
  onClose: () => void;
  initial?: Activity | null;
}) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: users } = useListUsers();
  const create = useCreateScheduledActivity();
  const update = useUpdateScheduledActivity();

  const [form, setForm] = useState<FormState>(() => buildForm(initial ?? null, user?.id));
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState("");

  // Sync form whenever the dialog opens or `initial` changes
  useEffect(() => {
    if (open) {
      setForm(buildForm(initial ?? null, user?.id));
      setFormErrors({});
      setServerError("");
    }
  }, [open, initial, user?.id]);

  const validateForm = () => {
    const errors: Record<string, string> = {};
    if (!form.subject.trim()) errors.subject = "Subject is required";
    if (!form.dueAt) errors.dueAt = "Due date and time is required";
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async () => {
    setServerError("");
    if (!validateForm()) return;
    try {
      const payload = {
        type: form.type,
        subject: form.subject.trim(),
        leadId: form.leadId ? Number(form.leadId) : undefined,
        ownerId: form.ownerId ? Number(form.ownerId) : undefined,
        dueAt: new Date(form.dueAt).toISOString(),
        priority: form.priority as any,
        notes: form.notes.trim() || undefined,
      };

      if (initial) {
        await update.mutateAsync({ id: initial.id, data: payload as any });
        toast({ title: "Activity updated" });
      } else {
        await create.mutateAsync({ data: payload });
        toast({ title: "Activity created" });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/scheduled-activities"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/my-day"] });
      onClose();
    } catch (e: any) {
      setServerError(e.message ?? "An unexpected error occurred. Please try again.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{initial ? "Edit Activity" : "New Activity"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select value={form.type} onValueChange={v => setForm(f => ({ ...f, type: v as ActivityType }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="task">📋 Task</SelectItem>
                  <SelectItem value="call">📞 Call</SelectItem>
                  <SelectItem value="meeting">🎥 Meeting</SelectItem>
                  <SelectItem value="followup">📅 Follow-up</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Priority</Label>
              <Select value={form.priority} onValueChange={v => setForm(f => ({ ...f, priority: v }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="high">🔴 High</SelectItem>
                  <SelectItem value="medium">🟡 Medium</SelectItem>
                  <SelectItem value="low">🟢 Low</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="activitySubject">Subject <span className="text-destructive">*</span></Label>
            <Input
              id="activitySubject"
              placeholder="e.g. Demo call with Acme Corp"
              value={form.subject}
              onChange={e => { setForm(f => ({ ...f, subject: e.target.value })); if (formErrors.subject) setFormErrors(p => ({ ...p, subject: "" })); }}
              aria-invalid={!!formErrors.subject}
              className={formErrors.subject ? "border-destructive" : ""}
            />
            {formErrors.subject && <p className="text-xs text-destructive" role="alert">{formErrors.subject}</p>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="activityDue">Due Date & Time <span className="text-destructive">*</span></Label>
            <Input
              id="activityDue"
              type="datetime-local"
              value={form.dueAt}
              onChange={e => { setForm(f => ({ ...f, dueAt: e.target.value })); if (formErrors.dueAt) setFormErrors(p => ({ ...p, dueAt: "" })); }}
              aria-invalid={!!formErrors.dueAt}
              className={formErrors.dueAt ? "border-destructive" : ""}
            />
            {formErrors.dueAt && <p className="text-xs text-destructive" role="alert">{formErrors.dueAt}</p>}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Related Lead</Label>
              <LeadCombobox value={form.leadId} onChange={v => setForm(f => ({ ...f, leadId: v }))} />
            </div>
            {user?.role !== "bd" && (
              <div className="space-y-1.5">
                <Label>Assigned To</Label>
                <Select value={form.ownerId} onValueChange={v => setForm(f => ({ ...f, ownerId: v }))}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select rep" />
                  </SelectTrigger>
                  <SelectContent>
                    {users?.map((u: any) => (
                      <SelectItem key={u.id} value={String(u.id)}>{u.username}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>Notes</Label>
            <Textarea
              placeholder="Additional notes..."
              value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              className="resize-none"
              rows={2}
            />
          </div>
        </div>
        {serverError && (
          <p className="text-sm text-destructive px-1 -mb-2" role="alert">{serverError}</p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="cta" onClick={handleSubmit} disabled={create.isPending || update.isPending}>
            {(create.isPending || update.isPending) && <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden="true" />}
            {initial ? "Save Changes" : "Create Activity"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function Activities() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: users } = useListUsers();

  const [view, setView] = useState<View>("day");
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [typeFilter, setTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [ownerFilter, setOwnerFilter] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editActivity, setEditActivity] = useState<Activity | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const queryParams: ListScheduledActivitiesParams = {
    view: view as ListScheduledActivitiesParams["view"],
    date: format(selectedDate, "yyyy-MM-dd"),
    type: (typeFilter || undefined) as ListScheduledActivitiesParams["type"],
    status: (statusFilter || undefined) as ListScheduledActivitiesParams["status"],
    ownerId: ownerFilter ? Number(ownerFilter) : undefined,
  };

  const { data, isLoading } = useListScheduledActivities(queryParams, {
    query: {
      queryKey: getListScheduledActivitiesQueryKey(queryParams),
      refetchInterval: 60000,
    },
  });

  const complete = useCompleteScheduledActivity();
  const deleteActivity = useDeleteScheduledActivity();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/scheduled-activities"] });
    queryClient.invalidateQueries({ queryKey: ["/api/dashboard/my-day"] });
  };

  const handleComplete = async (id: number) => {
    try {
      await complete.mutateAsync({ id });
      toast({ title: "Activity completed" });
      invalidate();
    } catch {
      toast({ title: "Failed to complete activity", variant: "destructive" });
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await deleteActivity.mutateAsync({ id: deleteId });
      toast({ title: "Activity deleted" });
      invalidate();
    } catch {
      toast({ title: "Failed to delete", variant: "destructive" });
    }
    setDeleteId(null);
  };

  const handleEdit = (a: Activity) => {
    setEditActivity(a);
    setDialogOpen(true);
  };

  const handleNew = (date?: Date) => {
    setEditActivity(null);
    if (date) setSelectedDate(date);
    setDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setDialogOpen(false);
    setEditActivity(null);
  };

  const activities: Activity[] = (data?.activities ?? []) as Activity[];

  const navigatePrev = () => {
    if (view === "day") setSelectedDate(d => addDays(d, -1));
    else if (view === "week") setSelectedDate(d => subWeeks(d, 1));
    else setSelectedDate(d => subMonths(d, 1));
  };

  const navigateNext = () => {
    if (view === "day") setSelectedDate(d => addDays(d, 1));
    else if (view === "week") setSelectedDate(d => addWeeks(d, 1));
    else setSelectedDate(d => addMonths(d, 1));
  };

  const weekStart = startOfWeek(selectedDate, { weekStartsOn: 1 });

  const getDateLabel = () => {
    if (view === "day") return format(selectedDate, "EEEE, MMMM d, yyyy");
    if (view === "week") {
      const end = addDays(weekStart, 6);
      return `${format(weekStart, "MMM d")} – ${format(end, "MMM d, yyyy")}`;
    }
    return format(selectedDate, "MMMM yyyy");
  };

  const stats = useMemo(() => ({
    total: activities.length,
    completed: activities.filter(a => a.status === "completed").length,
    overdue: activities.filter(a => a.status === "overdue").length,
    open: activities.filter(a => a.status === "open").length,
  }), [activities]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Activities</h1>
          <p className="text-muted-foreground text-sm">Calls, meetings, tasks, and follow-ups</p>
        </div>
        <Button variant="cta" onClick={() => handleNew()}>
          <Plus className="h-4 w-4 mr-2" /> New Activity
        </Button>
      </div>

      {/* View toggle + nav */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex rounded-lg border overflow-hidden">
          {(["day", "week", "month"] as View[]).map(v => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`px-4 py-1.5 text-sm font-medium capitalize transition-colors
                ${view === v ? "bg-primary text-primary-foreground" : "hover:bg-muted text-muted-foreground"}`}
            >
              {v}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={navigatePrev}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <button
            className="text-sm font-medium min-w-[220px] text-center hover:text-primary transition-colors"
            onClick={() => setSelectedDate(new Date())}
            title="Go to today"
          >
            {getDateLabel()}
          </button>
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={navigateNext}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        <Button variant="outline" size="sm" onClick={() => setSelectedDate(new Date())}>Today</Button>
      </div>

      {/* Stats row */}
      {activities.length > 0 && (
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          <span>{stats.total} total</span>
          {stats.open > 0 && <span className="text-blue-600">{stats.open} open</span>}
          {stats.overdue > 0 && <span className="text-red-600 font-medium">⚠️ {stats.overdue} overdue</span>}
          {stats.completed > 0 && <span className="text-green-600">✓ {stats.completed} done</span>}
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <Select value={typeFilter || "all"} onValueChange={v => setTypeFilter(v === "all" ? "" : v)}>
          <SelectTrigger className="w-[140px] h-8 text-sm">
            <SelectValue placeholder="All types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            <SelectItem value="task">📋 Task</SelectItem>
            <SelectItem value="call">📞 Call</SelectItem>
            <SelectItem value="meeting">🎥 Meeting</SelectItem>
            <SelectItem value="followup">📅 Follow-up</SelectItem>
          </SelectContent>
        </Select>

        <Select value={statusFilter || "all"} onValueChange={v => setStatusFilter(v === "all" ? "" : v)}>
          <SelectTrigger className="w-[140px] h-8 text-sm">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="open">Open</SelectItem>
            <SelectItem value="overdue">Overdue</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>

        {user?.role !== "bd" && (
          <Select value={ownerFilter || "all"} onValueChange={v => setOwnerFilter(v === "all" ? "" : v)}>
            <SelectTrigger className="w-[150px] h-8 text-sm">
              <SelectValue placeholder="All reps" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All reps</SelectItem>
              {users?.map((u: any) => (
                <SelectItem key={u.id} value={String(u.id)}>{u.username}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Calendar views */}
      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : view === "day" ? (
        <DayView
          activities={activities}
          selectedDate={selectedDate}
          onEdit={handleEdit}
          onComplete={handleComplete}
          onDelete={setDeleteId}
          onNew={handleNew}
        />
      ) : view === "week" ? (
        <WeekView
          activities={activities}
          weekStart={weekStart}
          onEdit={handleEdit}
          onComplete={handleComplete}
          onDelete={setDeleteId}
          onNew={handleNew}
        />
      ) : (
        <MonthView
          activities={activities}
          selectedDate={selectedDate}
          onDayClick={d => { setSelectedDate(d); setView("day"); }}
        />
      )}

      {/* Create/Edit Dialog */}
      <ActivityDialog
        open={dialogOpen}
        onClose={handleCloseDialog}
        initial={editActivity}
      />

      {/* Delete Confirm */}
      <AlertDialog open={!!deleteId} onOpenChange={o => { if (!o) setDeleteId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete activity?</AlertDialogTitle>
            <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
