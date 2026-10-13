import { Router, type IRouter, type Request, type Response } from "express";
import { db, tasksTable, usersTable, leadsTable, notificationsTable } from "@workspace/db";
import { eq, desc, and } from "drizzle-orm";
import { wsFilter } from "../lib/workspaceScope";
import { requirePermission } from "../lib/permissions";
import { z } from "zod";

const TaskInputSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  dueDate: z.string().optional().nullable(),
  status: z.enum(["todo", "in_progress", "done"]).optional(),
  priority: z.enum(["low", "medium", "high"]).optional(),
  assignedToId: z.number().int().optional().nullable(),
});

const TaskUpdateSchema = TaskInputSchema.partial();

const router: IRouter = Router();

async function getTaskDto(id: number) {
  const [task] = await db.select().from(tasksTable).where(eq(tasksTable.id, id));
  if (!task) return null;
  const [assignedTo] = task.assignedToId
    ? await db.select().from(usersTable).where(eq(usersTable.numId, task.assignedToId))
    : [null];
  const [createdBy] = task.createdById
    ? await db.select().from(usersTable).where(eq(usersTable.numId, task.createdById))
    : [null];
  const [lead] = task.leadId
    ? await db.select().from(leadsTable).where(eq(leadsTable.id, task.leadId))
    : [null];
  return {
    ...task,
    assignedToName: assignedTo
      ? (`${assignedTo.firstName ?? ""} ${assignedTo.lastName ?? ""}`.trim() || assignedTo.email?.split("@")[0] || null)
      : null,
    createdByName: createdBy
      ? (`${createdBy.firstName ?? ""} ${createdBy.lastName ?? ""}`.trim() || createdBy.email?.split("@")[0] || null)
      : null,
    leadCompanyName: lead?.companyName ?? null,
    dueDate: task.dueDate?.toISOString() ?? null,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
  };
}

router.get("/leads/:leadId/tasks", requirePermission("tasks.view"), async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const leadId = Number(req.params.leadId);
  const status = req.query.status as string | undefined;
  const wid = req.user.workspaceId ?? null;

  const [lead] = await db.select().from(leadsTable)
    .where(and(eq(leadsTable.id, leadId), wsFilter(leadsTable.workspaceId, wid)));
  if (!lead) { res.status(404).json({ error: "Not found" }); return; }

  let tasks = await db.select().from(tasksTable)
    .where(and(eq(tasksTable.leadId, leadId), wsFilter(tasksTable.workspaceId, wid)))
    .orderBy(desc(tasksTable.createdAt));
  if (status) tasks = tasks.filter(t => t.status === status);

  const result = (await Promise.all(tasks.map(t => getTaskDto(t.id)))).filter(Boolean);
  res.json(result);
});

router.post("/leads/:leadId/tasks", requirePermission("tasks.create"), async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const leadId = Number(req.params.leadId);
  const parsed = TaskInputSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid input" }); return; }
  const wid = req.user.workspaceId ?? null;

  const [lead] = await db.select().from(leadsTable)
    .where(and(eq(leadsTable.id, leadId), wsFilter(leadsTable.workspaceId, wid)));
  if (!lead) { res.status(404).json({ error: "Not found" }); return; }

  const [task] = await db.insert(tasksTable).values({
    ...parsed.data,
    leadId,
    createdById: req.user.id,
    workspaceId: wid,
    dueDate: parsed.data.dueDate ? new Date(parsed.data.dueDate) : null,
    assignedToId: parsed.data.assignedToId ?? null,
  }).returning();

  if (task.assignedToId && task.assignedToId !== req.user.id) {
    await db.insert(notificationsTable).values({
      userId: task.assignedToId,
      type: "task_assigned",
      title: `New task: ${task.title}`,
      body: `For lead: ${lead.companyName}`,
      leadId,
      taskId: task.id,
      workspaceId: wid,
    }).catch(() => {});
  }

  const dto = await getTaskDto(task.id);
  res.status(201).json(dto);
});

router.get("/tasks", requirePermission("tasks.view"), async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
  const offset = (page - 1) * limit;
  const leadIdFilter = req.query.leadId ? Number(req.query.leadId) : undefined;
  const assignedToFilter = req.query.assignedToId ? Number(req.query.assignedToId) : undefined;
  const statusFilter = req.query.status as string | undefined;
  const priorityFilter = req.query.priority as string | undefined;
  const wid = req.user.workspaceId ?? null;

  let tasks = await db.select().from(tasksTable)
    .where(wsFilter(tasksTable.workspaceId, wid))
    .orderBy(desc(tasksTable.createdAt));

  if (leadIdFilter) tasks = tasks.filter(t => t.leadId === leadIdFilter);
  if (assignedToFilter) tasks = tasks.filter(t => t.assignedToId === assignedToFilter);
  if (statusFilter) tasks = tasks.filter(t => t.status === statusFilter);
  if (priorityFilter) tasks = tasks.filter(t => t.priority === priorityFilter);
  if (req.user.role === "bd") {
    tasks = tasks.filter(t => t.assignedToId === req.user.id || t.createdById === req.user.id);
  }

  const total = tasks.length;
  const pageRows = tasks.slice(offset, offset + limit);
  const result = (await Promise.all(pageRows.map(t => getTaskDto(t.id)))).filter(Boolean);
  res.json({ tasks: result, total, page, limit });
});

router.patch("/tasks/:id", requirePermission("tasks.edit"), async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const id = Number(req.params.id);
  const parsed = TaskUpdateSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid input" }); return; }
  const wid = req.user.workspaceId ?? null;

  const [existing] = await db.select().from(tasksTable)
    .where(and(eq(tasksTable.id, id), wsFilter(tasksTable.workspaceId, wid)));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }

  const updateData: Record<string, unknown> = { ...parsed.data };
  if ("dueDate" in parsed.data) {
    updateData.dueDate = parsed.data.dueDate ? new Date(parsed.data.dueDate) : null;
  }
  if ("assignedToId" in parsed.data) {
    updateData.assignedToId = parsed.data.assignedToId ?? null;
  }

  const [task] = await db.update(tasksTable).set(updateData as any).where(eq(tasksTable.id, id)).returning();

  if (parsed.data.assignedToId && parsed.data.assignedToId !== existing.assignedToId && parsed.data.assignedToId !== req.user.id) {
    await db.insert(notificationsTable).values({
      userId: parsed.data.assignedToId,
      type: "task_assigned",
      title: `Task assigned to you: ${task.title}`,
      body: task.leadId ? `Lead task` : null,
      leadId: task.leadId ?? null,
      taskId: task.id,
      workspaceId: wid,
    }).catch(() => {});
  }

  const dto = await getTaskDto(task.id);
  res.json(dto);
});

router.delete("/tasks/:id", requirePermission("tasks.delete"), async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const id = Number(req.params.id);
  const wid = req.user.workspaceId ?? null;

  const [existing] = await db.select().from(tasksTable)
    .where(and(eq(tasksTable.id, id), wsFilter(tasksTable.workspaceId, wid)));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }

  await db.delete(tasksTable).where(eq(tasksTable.id, id));
  res.status(204).send();
});

export default router;
