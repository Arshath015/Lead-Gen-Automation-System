import * as zod from "zod";
import { Router, type IRouter, type Request, type Response } from "express";
import { db, usersTable, sessionsTable, rolesTable } from "@workspace/db";
import { seedDefaultNotificationPrefs } from "../lib/seedDefaultNotificationPrefs";
import { eq } from "drizzle-orm";
import { sendWelcomeEmail, sendRejectionEmail } from "../lib/email";
import { requirePermission, invalidatePermCache } from "../lib/permissions";

const router: IRouter = Router();

/**
 * Maps the legacy role string used at approval time to the corresponding
 * system role display name in the roles table.
 */
const ROLE_STRING_TO_ROLE_NAME: Record<string, string> = {
  admin:   "Admin",
  manager: "Manager",
  bd:      "Sales Member",
};

/**
 * Looks up the roleId for a given legacy role string within a workspace.
 * Prefers workspace-scoped roles over global (workspaceId=null) roles.
 */
async function resolveRoleId(roleString: string, workspaceId: number | null | undefined): Promise<number | null> {
  const roleName = ROLE_STRING_TO_ROLE_NAME[roleString];
  if (!roleName) return null;

  // Fetch all roles matching this name (workspace-scoped and global), prefer workspace-scoped
  const rows = await db
    .select({ id: rolesTable.id, workspaceId: rolesTable.workspaceId })
    .from(rolesTable)
    .where(eq(rolesTable.name, roleName));

  if (rows.length === 0) return null;
  const wsRow = rows.find(r => r.workspaceId != null && r.workspaceId === workspaceId);
  const globalRow = rows.find(r => r.workspaceId == null);
  return (wsRow ?? globalRow ?? rows[0]).id;
}

function requireAdmin(req: Request, res: Response): boolean {
  if (!req.isAuthenticated() || req.user.role !== "admin") {
    res.status(403).json({ error: "Forbidden" });
    return false;
  }
  return true;
}

function userToDto(u: typeof usersTable.$inferSelect) {
  return {
    id: u.numId,
    email: u.email,
    firstName: u.firstName,
    lastName: u.lastName,
    fullName: (`${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || u.email?.split("@")[0]) ?? `user${u.numId}`,
    company: u.company,
    requestedRole: u.requestedRole,
    role: u.role,
    accountStatus: u.accountStatus,
    rejectionReason: u.rejectionReason,
    createdAt: u.createdAt.toISOString(),
  };
}

// List all users in the approval queue (pending) or all non-active statuses
router.get("/approvals", requirePermission("approvals.view"), async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  const status = (req.query.status as string) ?? "pending";
  const rows = await db.select().from(usersTable);
  const filtered = status === "all"
    ? rows
    : rows.filter(u => u.accountStatus === status);
  res.json(filtered.map(userToDto));
});

// Approve a pending user
router.post("/approvals/:id/approve", requirePermission("approvals.approve"), async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  const id = Number(req.params.id);

  const body = zod.object({
    role: zod.enum(["admin", "manager", "bd"]).default("bd"),
    teamId: zod.number().nullish(),
    managerId: zod.number().nullish(),
  }).safeParse(req.body);

  if (!body.success) { res.status(400).json({ error: "Invalid input" }); return; }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.numId, id));
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  // Resolve the RBAC roleId that corresponds to the approved role string
  const wid = user.workspaceId ?? req.user!.workspaceId ?? null;
  const roleId = await resolveRoleId(body.data.role, wid);

  const updates: Partial<typeof usersTable.$inferInsert> = {
    accountStatus: "active",
    isActive: true,
    role: body.data.role,
    rejectionReason: null,
    ...(roleId != null ? { roleId } : {}),
  };
  if (body.data.teamId !== undefined) updates.teamId = body.data.teamId ?? null;
  if (body.data.managerId !== undefined) updates.managerId = body.data.managerId ?? null;

  const [updated] = await db.update(usersTable).set(updates).where(eq(usersTable.numId, id)).returning();

  // Invalidate any cached permissions for this user so they take effect immediately
  invalidatePermCache(id, wid);

  // Seed default notification preferences now that the account is active.
  // Uses ON CONFLICT DO NOTHING — safe if they somehow already have a row.
  await seedDefaultNotificationPrefs(id, wid);

  // Send welcome email
  const name = (`${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || user.email) ?? "User";
  if (user.email) sendWelcomeEmail(name, user.email).catch(() => {});

  res.json(userToDto(updated));
});

// Reject a pending user
router.post("/approvals/:id/reject", requirePermission("approvals.reject"), async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  const id = Number(req.params.id);
  const { reason } = zod.object({ reason: zod.string().optional() }).parse(req.body);

  const [user] = await db.select().from(usersTable).where(eq(usersTable.numId, id));
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  const [updated] = await db
    .update(usersTable)
    .set({ accountStatus: "rejected", isActive: false, rejectionReason: reason ?? null })
    .where(eq(usersTable.numId, id))
    .returning();

  const name = (`${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || user.email) ?? "User";
  if (user.email) sendRejectionEmail(name, user.email, reason).catch(() => {});

  res.json(userToDto(updated));
});

// Disable an active user
router.post("/approvals/:id/disable", requirePermission("approvals.approve"), async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  const id = Number(req.params.id);
  const [updated] = await db
    .update(usersTable)
    .set({ accountStatus: "disabled", isActive: false })
    .where(eq(usersTable.numId, id))
    .returning();
  if (!updated) { res.status(404).json({ error: "User not found" }); return; }
  res.json(userToDto(updated));
});

// Re-enable a disabled user
router.post("/approvals/:id/enable", requirePermission("approvals.approve"), async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  const id = Number(req.params.id);
  const [updated] = await db
    .update(usersTable)
    .set({ accountStatus: "active", isActive: true })
    .where(eq(usersTable.numId, id))
    .returning();
  if (!updated) { res.status(404).json({ error: "User not found" }); return; }
  res.json(userToDto(updated));
});

export default router;
