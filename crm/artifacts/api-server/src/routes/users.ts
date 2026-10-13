import * as zod from "zod";
import { Router, type IRouter, type Request, type Response } from "express";
import { db, usersTable, teamMembersTable, auditLogsTable, sessionsTable, loginHistoryTable } from "@workspace/db";
import { seedDefaultNotificationPrefs } from "../lib/seedDefaultNotificationPrefs";
import { and, eq, desc, sql } from "drizzle-orm";
import { wsFilter } from "../lib/workspaceScope";
import { requirePermission, guardSuperAdmin } from "../lib/permissions";
import {
  ListUsersQueryParams,
  GetUserParams,
  UpdateUserParams,
  UpdateUserBody,
  DeleteUserParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

function userToDto(u: typeof usersTable.$inferSelect) {
  return {
    id: u.numId,
    replitId: u.id,
    username: u.email?.split("@")[0] ?? `user${u.numId}`,
    firstName: u.firstName,
    lastName: u.lastName,
    email: u.email,
    profileImage: u.profileImageUrl,
    role: u.role,
    roleId: u.roleId ?? null,
    teamId: u.teamId ?? null,
    managerId: u.managerId ?? null,
    targetAmount: u.targetAmount ?? null,
    isActive: u.isActive,
    isSuperAdmin: u.isSuperAdmin,
    phone: u.phone ?? null,
    department: u.department ?? null,
    accountStatus: u.accountStatus,
    failedLoginCount: u.failedLoginCount,
    lockedUntil: u.lockedUntil?.toISOString() ?? null,
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    lastLoginIp: u.lastLoginIp ?? null,
    createdAt: u.createdAt.toISOString(),
  };
}

router.get("/users", requirePermission("users.view"), async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const params = ListUsersQueryParams.safeParse(req.query);
  const { role, search } = params.success ? params.data : {};
  const wid = req.user.workspaceId ?? null;

  const rows = await db.select().from(usersTable).where(wsFilter(usersTable.workspaceId, wid));
  let results = rows;
  if (role) results = results.filter(u => u.role === role);
  if (search) {
    const s = search.toLowerCase();
    results = results.filter(u =>
      u.email?.toLowerCase().includes(s) ||
      u.firstName?.toLowerCase().includes(s) ||
      u.lastName?.toLowerCase().includes(s)
    );
  }
  res.json(results.map(userToDto));
});

router.post("/users", requirePermission("users.create"), async (req: Request, res: Response) => {
  if (!req.isAuthenticated() || req.user.role !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }
  const wid = req.user.workspaceId ?? null;

  const body = zod.object({
    email: zod.string().email("Valid email is required"),
    password: zod.string().min(8, "Password must be at least 8 characters"),
    firstName: zod.string().optional(),
    lastName: zod.string().optional(),
    role: zod.enum(["admin", "manager", "bd"]).default("bd"),
    phone: zod.string().optional(),
    department: zod.string().optional(),
  }).safeParse(req.body);

  if (!body.success) {
    res.status(400).json({ error: body.error.issues[0]?.message ?? "Invalid input" });
    return;
  }

  const { email, password, firstName, lastName, role, phone, department } = body.data;

  // Check email uniqueness within this workspace
  const existing = await db.select({ id: usersTable.id }).from(usersTable)
    .where(and(eq(usersTable.email, email), wsFilter(usersTable.workspaceId, wid)));
  if (existing.length > 0) {
    res.status(409).json({ error: "A user with this email already exists" });
    return;
  }

  const { hash } = await import("bcryptjs");
  const passwordHash = await hash(password, 12);

  const [user] = await db
    .insert(usersTable)
    .values({
      email, firstName: firstName ?? null, lastName: lastName ?? null, passwordHash, role,
      phone: phone ?? null, department: department ?? null,
      accountStatus: "active", mustChangePassword: false,
      workspaceId: wid,
    })
    .returning();

  // Seed default notification preferences for the new active user (opt-out model)
  await seedDefaultNotificationPrefs(user.numId, wid);

  res.status(201).json(userToDto(user));
});

router.get("/users/:id", requirePermission("users.view"), async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const params = GetUserParams.safeParse({ id: Number(req.params.id) });
  if (!params.success) { res.status(400).json({ error: "Invalid id" }); return; }
  const wid = req.user.workspaceId ?? null;

  const [user] = await db.select().from(usersTable)
    .where(and(eq(usersTable.numId, params.data.id), wsFilter(usersTable.workspaceId, wid)));
  if (!user) { res.status(404).json({ error: "Not found" }); return; }
  res.json(userToDto(user));
});

router.patch("/users/:id", requirePermission("users.edit"), async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const params = UpdateUserParams.safeParse({ id: Number(req.params.id) });
  const body = UpdateUserBody.safeParse(req.body);
  if (!params.success || !body.success) { res.status(400).json({ error: "Invalid input" }); return; }
  const wid = req.user.workspaceId ?? null;

  // Non-admins can only edit their own profile (limited fields)
  if (req.user.role !== "admin" && params.data.id !== req.user.id) {
    res.status(403).json({ error: "Forbidden" }); return;
  }

  const [existing] = await db.select().from(usersTable)
    .where(and(eq(usersTable.numId, params.data.id), wsFilter(usersTable.workspaceId, wid)));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }

  if (!(await guardSuperAdmin(req, res, existing.numId))) return;

  const { firstName, lastName, email, role, isActive, teamId, managerId, targetAmount, roleId } = body.data as any;
  const updateData: Partial<typeof usersTable.$inferInsert> = {};
  if (firstName !== undefined) updateData.firstName = firstName;
  if (lastName !== undefined) updateData.lastName = lastName;
  if (email !== undefined) updateData.email = email;
  // Admin-only fields
  if (req.user.role === "admin") {
    if (role !== undefined) updateData.role = role as "admin" | "manager" | "bd";
    if (isActive !== undefined) updateData.isActive = isActive;
    if (teamId !== undefined) updateData.teamId = teamId;
    if (managerId !== undefined) updateData.managerId = managerId;
    if (targetAmount !== undefined) updateData.targetAmount = targetAmount;
    if (roleId !== undefined) updateData.roleId = roleId;
  }
  const [user] = await db.update(usersTable).set(updateData).where(eq(usersTable.numId, params.data.id)).returning();
  if (!user) { res.status(404).json({ error: "Not found" }); return; }

  // Sync team_members when teamId changes
  if (req.user.role === "admin" && teamId !== undefined && teamId !== existing.teamId) {
    if (existing.teamId) {
      await db.delete(teamMembersTable)
        .where(and(eq(teamMembersTable.teamId, existing.teamId), eq(teamMembersTable.userId, existing.numId)));
    }
    if (teamId !== null) {
      await db.insert(teamMembersTable).values({ teamId, userId: existing.numId }).onConflictDoNothing();
    }
  }

  // Audit log role/team/manager changes
  const auditFields = ["role", "teamId", "managerId", "roleId", "isActive"] as const;
  for (const field of auditFields) {
    if (field in updateData && (updateData as any)[field] !== (existing as any)[field]) {
      await db.insert(auditLogsTable).values({
        userId: req.user.id,
        action: "updated",
        tableName: "users",
        fieldName: field,
        oldValue: String((existing as any)[field] ?? ""),
        newValue: String((updateData as any)[field] ?? ""),
        ipAddress: req.ip ?? null,
        workspaceId: wid,
      });
    }
  }

  res.json(userToDto(user));
});

router.delete("/users/:id", requirePermission("users.delete"), async (req: Request, res: Response) => {
  if (!req.isAuthenticated() || req.user.role !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }
  const params = DeleteUserParams.safeParse({ id: Number(req.params.id) });
  if (!params.success) { res.status(400).json({ error: "Invalid id" }); return; }
  const wid = req.user.workspaceId ?? null;

  // Verify the user belongs to this workspace before deleting
  const [existing] = await db.select().from(usersTable)
    .where(and(eq(usersTable.numId, params.data.id), wsFilter(usersTable.workspaceId, wid)));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }

  if (!(await guardSuperAdmin(req, res, existing.numId))) return;

  await db.delete(usersTable).where(eq(usersTable.numId, params.data.id));
  res.status(204).send();
});

// Force logout — admin invalidates all sessions for a user and unlocks their account
router.post("/users/:id/force-logout", requirePermission("users.edit"), async (req: Request, res: Response) => {
  if (!req.isAuthenticated() || req.user.role !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const wid = req.user.workspaceId ?? null;

  // Verify the user is in the same workspace
  const [target] = await db.select().from(usersTable)
    .where(and(eq(usersTable.numId, id), wsFilter(usersTable.workspaceId, wid)));
  if (!target) { res.status(404).json({ error: "Not found" }); return; }

  if (!(await guardSuperAdmin(req, res, target.numId))) return;

  await db.execute(
    sql`DELETE FROM sessions WHERE (sess->'user'->>'id')::int = ${id}`
  );

  await db.update(usersTable).set({ failedLoginCount: 0, lockedUntil: null }).where(eq(usersTable.numId, id));

  await db.insert(auditLogsTable).values({
    leadId: null,
    userId: req.user.id,
    action: "force_logout",
    tableName: "users",
    fieldName: "sessions",
    oldValue: null,
    newValue: `All sessions revoked for user ${id}`,
    ipAddress: req.ip ?? null,
    workspaceId: wid,
  }).catch(() => {});

  res.json({ success: true, message: "User sessions cleared and account unlocked" });
});

// Unlock a locked account (admin only)
router.post("/users/:id/unlock", requirePermission("users.edit"), async (req: Request, res: Response) => {
  if (!req.isAuthenticated() || req.user.role !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const wid = req.user.workspaceId ?? null;

  const [target] = await db.select().from(usersTable)
    .where(and(eq(usersTable.numId, id), wsFilter(usersTable.workspaceId, wid)));
  if (!target) { res.status(404).json({ error: "Not found" }); return; }

  if (!(await guardSuperAdmin(req, res, target.numId))) return;

  await db.update(usersTable).set({ failedLoginCount: 0, lockedUntil: null }).where(eq(usersTable.numId, id));
  res.json({ success: true });
});

// Login history for a user (admin only)
router.get("/users/:id/login-history", requirePermission("users.view"), async (req: Request, res: Response) => {
  if (!req.isAuthenticated() || req.user.role !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const wid = req.user.workspaceId ?? null;

  const [target] = await db.select().from(usersTable)
    .where(and(eq(usersTable.numId, id), wsFilter(usersTable.workspaceId, wid)));
  if (!target) { res.status(404).json({ error: "Not found" }); return; }

  const history = await db.select().from(loginHistoryTable)
    .where(eq(loginHistoryTable.userId, id))
    .orderBy(desc(loginHistoryTable.createdAt))
    .limit(50);
  res.json(history.map(h => ({ ...h, createdAt: h.createdAt.toISOString() })));
});

export default router;
