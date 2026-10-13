import { Router, type IRouter, type Request, type Response } from "express";
import { db, usersTable, userPermissionOverridesTable, auditLogsTable } from "@workspace/db";
import { PERMISSION_MATRIX } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { wsFilter } from "../lib/workspaceScope";
import { requirePermission, invalidatePermCache, guardSuperAdmin } from "../lib/permissions";

const router: IRouter = Router();

// GET /permissions/matrix — returns the full permission matrix for the UI
router.get("/permissions/matrix", async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  res.json(PERMISSION_MATRIX);
});

// GET /users/:id/permission-overrides
router.get(
  "/users/:id/permission-overrides",
  requirePermission("roles.view"),
  async (req: Request, res: Response) => {
    const userId = Number(req.params.id);
    if (isNaN(userId)) { res.status(400).json({ error: "Invalid user ID" }); return; }
    const wid = req.user!.workspaceId ?? null;
    const overrides = await db
      .select()
      .from(userPermissionOverridesTable)
      .where(
        and(
          eq(userPermissionOverridesTable.userId, userId),
          wsFilter(userPermissionOverridesTable.workspaceId, wid)
        )
      );
    res.json(
      overrides.map(o => ({
        id: o.id,
        userId: o.userId,
        workspaceId: o.workspaceId ?? null,
        module: o.module,
        action: o.action,
        allowed: o.allowed,
        grantedBy: o.grantedBy ?? null,
        createdAt: o.createdAt.toISOString(),
      }))
    );
  }
);

// PUT /users/:id/permission-overrides — replace all permission overrides for a user
router.put(
  "/users/:id/permission-overrides",
  requirePermission("roles.edit"),
  async (req: Request, res: Response) => {
    const userId = Number(req.params.id);
    if (isNaN(userId)) { res.status(400).json({ error: "Invalid user ID" }); return; }
    const wid = req.user!.workspaceId ?? null;
    const { overrides } = req.body as { overrides?: Array<{ module: string; action: string; allowed: boolean }> };
    if (!Array.isArray(overrides)) { res.status(400).json({ error: "overrides must be an array" }); return; }

    // Verify target user exists in this workspace
    const [targetUser] = await db
      .select({ numId: usersTable.numId })
      .from(usersTable)
      .where(and(eq(usersTable.numId, userId), wsFilter(usersTable.workspaceId, wid)));
    if (!targetUser) { res.status(404).json({ error: "User not found" }); return; }

    if (!(await guardSuperAdmin(req, res, userId))) return;

    // Replace overrides
    await db.delete(userPermissionOverridesTable)
      .where(
        and(
          eq(userPermissionOverridesTable.userId, userId),
          wsFilter(userPermissionOverridesTable.workspaceId, wid)
        )
      );

    const inserted =
      overrides.length > 0
        ? await db
            .insert(userPermissionOverridesTable)
            .values(
              overrides.map(o => ({
                userId,
                workspaceId: wid,
                module: o.module,
                action: o.action,
                allowed: !!o.allowed,
                grantedBy: req.user!.id,
              }))
            )
            .returning()
        : [];

    invalidatePermCache(userId, wid);

    await db.insert(auditLogsTable).values({
      userId: req.user!.id,
      action: "updated",
      tableName: "user_permission_overrides",
      fieldName: "overrides",
      newValue: `${overrides.filter(o => o.allowed).length} grants, ${overrides.filter(o => !o.allowed).length} denials`,
      ipAddress: req.ip ?? null,
      workspaceId: wid,
    });

    res.json(
      inserted.map(o => ({
        id: o.id,
        userId: o.userId,
        workspaceId: o.workspaceId ?? null,
        module: o.module,
        action: o.action,
        allowed: o.allowed,
        grantedBy: o.grantedBy ?? null,
        createdAt: o.createdAt.toISOString(),
      }))
    );
  }
);

export default router;
