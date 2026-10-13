import { useState } from "react";
import { useListLeadTasks, useCreateTask, useUpdateTask, useDeleteTask, useListUsers } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Plus, MoreHorizontal, CheckCircle2, Circle, Clock, Loader2 } from "lucide-react";
import { format, parseISO } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";

type TaskStatus = "todo" | "in_progress" | "done";
type TaskPriority = "low" | "medium" | "high";

const STATUS_CONFIG: Record<TaskStatus, { label: string; icon: React.ReactNode; className: string }> = {
  todo: { label: "To Do", icon: <Circle className="h-4 w-4" />, className: "text-muted-foreground" },
  in_progress: { label: "In Progress", icon: <Clock className="h-4 w-4 text-amber-500" />, className: "text-amber-600" },
  done: { label: "Done", icon: <CheckCircle2 className="h-4 w-4 text-green-500" />, className: "text-green-600" },
};

const PRIORITY_CONFIG: Record<TaskPriority, { label: string; className: string }> = {
  low: { label: "Low", className: "bg-slate-100 text-slate-600 border-slate-200" },
  medium: { label: "Medium", className: "bg-amber-100 text-amber-700 border-amber-200" },
  high: { label: "High", className: "bg-red-100 text-red-700 border-red-200" },
};

interface TaskFormData {
  title: string;
  description: string;
  dueDate: string;
  status: TaskStatus;
  priority: TaskPriority;
  assignedToId: string;
}

const defaultForm: TaskFormData = {
  title: "",
  description: "",
  dueDate: "",
  status: "todo",
  priority: "medium",
  assignedToId: "unassigned",
};

export function TasksTab({ leadId }: { leadId: number }) {
  const { data: tasks, isLoading } = useListLeadTasks(leadId);
  const { data: users } = useListUsers();
  const createTask = useCreateTask();
  const updateTask = useUpdateTask();
  const deleteTask = useDeleteTask();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [createOpen, setCreateOpen] = useState(false);
  const [editTask, setEditTask] = useState<any | null>(null);
  const [form, setForm] = useState<TaskFormData>(defaultForm);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: [`/api/leads/${leadId}/tasks`] });
  };

  const openCreate = () => {
    setForm(defaultForm);
    setEditTask(null);
    setCreateOpen(true);
  };

  const openEdit = (task: any) => {
    setForm({
      title: task.title,
      description: task.description ?? "",
      dueDate: task.dueDate ? task.dueDate.slice(0, 10) : "",
      status: task.status,
      priority: task.priority,
      assignedToId: task.assignedToId ? String(task.assignedToId) : "unassigned",
    });
    setEditTask(task);
    setCreateOpen(true);
  };

  const handleSubmit = async () => {
    if (!form.title.trim()) { toast({ title: "Title is required", variant: "destructive" }); return; }
    const payload = {
      title: form.title,
      description: form.description || undefined,
      dueDate: form.dueDate || undefined,
      status: form.status,
      priority: form.priority,
      assignedToId: form.assignedToId && form.assignedToId !== "unassigned" ? Number(form.assignedToId) : undefined,
    };
    try {
      if (editTask) {
        await updateTask.mutateAsync({ id: editTask.id, data: payload });
        toast({ title: "Task updated" });
      } else {
        await createTask.mutateAsync({ leadId, data: payload });
        toast({ title: "Task created" });
      }
      setCreateOpen(false);
      invalidate();
    } catch {
      toast({ title: "Failed to save task", variant: "destructive" });
    }
  };

  const handleStatusChange = async (task: any, status: TaskStatus) => {
    try {
      await updateTask.mutateAsync({ id: task.id, data: { status } });
      invalidate();
    } catch {
      toast({ title: "Failed to update status", variant: "destructive" });
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteTask.mutateAsync({ id });
      toast({ title: "Task deleted" });
      invalidate();
    } catch {
      toast({ title: "Failed to delete task", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Tasks</h3>
        <Button size="sm" onClick={openCreate}>
          <Plus className="h-4 w-4 mr-1" /> Add Task
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : !tasks?.length ? (
        <div className="text-center py-8 text-muted-foreground text-sm border border-dashed rounded-lg">
          No tasks yet. Add the first one!
        </div>
      ) : (
        <div className="space-y-2">
          {tasks.map((task: any) => (
            <div key={task.id} className="flex items-start gap-3 p-3 rounded-lg border bg-card hover:bg-muted/30 transition-colors">
              <button
                className={`mt-0.5 flex-shrink-0 ${STATUS_CONFIG[task.status as TaskStatus]?.className}`}
                onClick={() => {
                  const next: Record<TaskStatus, TaskStatus> = { todo: "in_progress", in_progress: "done", done: "todo" };
                  handleStatusChange(task, next[task.status as TaskStatus]);
                }}
                title="Click to change status"
              >
                {STATUS_CONFIG[task.status as TaskStatus]?.icon}
              </button>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-sm font-medium ${task.status === "done" ? "line-through text-muted-foreground" : ""}`}>
                    {task.title}
                  </span>
                  <Badge variant="outline" className={`text-xs ${PRIORITY_CONFIG[task.priority as TaskPriority]?.className}`}>
                    {PRIORITY_CONFIG[task.priority as TaskPriority]?.label}
                  </Badge>
                </div>
                {task.description && <p className="text-xs text-muted-foreground mt-0.5 truncate">{task.description}</p>}
                <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                  {task.dueDate && (
                    <span className={new Date(task.dueDate) < new Date() && task.status !== "done" ? "text-destructive font-medium" : ""}>
                      Due {format(parseISO(task.dueDate), "MMM d, yyyy")}
                    </span>
                  )}
                  {task.assignedToName && <span>→ {task.assignedToName}</span>}
                </div>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-7 w-7 flex-shrink-0">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => openEdit(task)}>Edit</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleStatusChange(task, "done")} disabled={task.status === "done"}>
                    Mark Done
                  </DropdownMenuItem>
                  <DropdownMenuItem className="text-destructive" onClick={() => handleDelete(task.id)}>Delete</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ))}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editTask ? "Edit Task" : "Add Task"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Title *</Label>
              <Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="Task title" />
            </div>
            <div>
              <Label>Description</Label>
              <Input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Optional description" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Priority</Label>
                <Select value={form.priority} onValueChange={v => setForm(f => ({ ...f, priority: v as TaskPriority }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Status</Label>
                <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v as TaskStatus }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todo">To Do</SelectItem>
                    <SelectItem value="in_progress">In Progress</SelectItem>
                    <SelectItem value="done">Done</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Due Date</Label>
                <Input type="date" value={form.dueDate} onChange={e => setForm(f => ({ ...f, dueDate: e.target.value }))} />
              </div>
              <div>
                <Label>Assign To</Label>
                <Select value={form.assignedToId} onValueChange={v => setForm(f => ({ ...f, assignedToId: v }))}>
                  <SelectTrigger><SelectValue placeholder="Unassigned" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unassigned">Unassigned</SelectItem>
                    {users?.map((u: any) => (
                      <SelectItem key={u.id} value={String(u.id)}>
                        {u.firstName ? `${u.firstName} ${u.lastName ?? ""}`.trim() : u.username}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={createTask.isPending || updateTask.isPending}>
              {(createTask.isPending || updateTask.isPending) && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {editTask ? "Save Changes" : "Create Task"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
