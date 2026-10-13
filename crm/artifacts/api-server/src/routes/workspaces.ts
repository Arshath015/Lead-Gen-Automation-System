import crypto from "crypto";
import bcrypt from "bcryptjs";
import { Router, type IRouter, type Request, type Response } from "express";
import { db, workspacesTable, usersTable, stagesTable, rolesTable } from "@workspace/db";
import { seedDefaultNotificationPrefs } from "../lib/seedDefaultNotificationPrefs";
import { and, eq } from "drizzle-orm";
import * as zod from "zod";
import { createSession, SESSION_COOKIE, SESSION_TTL, type SessionData } from "../lib/auth";
import { seedWorkspaceRoles, requirePermission } from "../lib/permissions";
import { dbUserToAuthUser } from "./auth";
import { logger } from "../lib/logger";
import { createWebToLeadToken, hashWebToLeadToken } from "../lib/web-to-lead";

const router: IRouter = Router();

const CreateWorkspaceBody = zod.object({
  companyName: zod.string().min(1, "Company name is required"),
  businessType: zod.string().optional(),
  industry: zod.string().optional(),
  employeeCount: zod.string().optional(),
  email: zod.string().email("Valid business email required"),
  phone: zod.string().optional(),
  website: zod.string().optional(),
  address: zod.string().optional(),
  timezone: zod.string().default("UTC"),
  currency: zod.string().default("USD"),
  adminFirstName: zod.string().min(1, "First name is required"),
  adminLastName: zod.string().min(1, "Last name is required"),
  adminEmail: zod.string().email("Valid admin email required"),
  adminPassword: zod.string().min(8, "Password must be at least 8 characters"),
  confirmPassword: zod.string(),
}).refine(d => d.adminPassword === d.confirmPassword, {
  message: "Passwords do not match",
  path: ["confirmPassword"],
});

const DEFAULT_STAGES = [
  { name: "New Lead",      color: "#6366f1", order: 0, isDefault: true,  isWon: false, isLost: false },
  { name: "Contacted",     color: "#06b6d4", order: 1, isDefault: false, isWon: false, isLost: false },
  { name: "Qualified",     color: "#8b5cf6", order: 2, isDefault: false, isWon: false, isLost: false },
  { name: "Proposal Sent", color: "#f59e0b", order: 3, isDefault: false, isWon: false, isLost: false },
  { name: "Negotiation",   color: "#f97316", order: 4, isDefault: false, isWon: false, isLost: false },
  { name: "Won",           color: "#22c55e", order: 5, isDefault: false, isWon: true,  isLost: false },
  { name: "Lost",          color: "#ef4444", order: 6, isDefault: false, isWon: false, isLost: true  },
];

function generateWorkspaceId(): string {
  return "ws_" + crypto.randomBytes(5).toString("hex");
}

function setSessionCookie(res: Response, sid: string) {
  res.cookie(SESSION_COOKIE, sid, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL,
  });
}

// Public: check if email is already in use for a workspace admin
router.get("/workspaces/check-email", async (req: Request, res: Response) => {
  const email = typeof req.query.email === "string" ? req.query.email : "";
  if (!email) { res.json({ available: false }); return; }
  const [existing] = await db.select({ id: usersTable.numId }).from(usersTable).where(eq(usersTable.email, email));
  res.json({ available: !existing });
});

// Public: create a new workspace + first admin user + default pipeline
router.post("/workspaces", async (req: Request, res: Response) => {
  const parsed = CreateWorkspaceBody.safeParse(req.body);
  if (!parsed.success) {
    const firstError = parsed.error.errors[0];
    res.status(400).json({ error: firstError?.message ?? "Invalid input" });
    return;
  }

  const d = parsed.data;

  // Check admin email not already taken
  const [existingUser] = await db
    .select({ id: usersTable.numId })
    .from(usersTable)
    .where(eq(usersTable.email, d.adminEmail));

  if (existingUser) {
    res.status(409).json({ error: "An account with this email already exists" });
    return;
  }

  try {
    // 1. Create workspace record
    const workspaceId = generateWorkspaceId();
    const [workspace] = await db
      .insert(workspacesTable)
      .values({
        workspaceId,
        name: d.companyName,
        businessType: d.businessType ?? null,
        industry: d.industry ?? null,
        employeeCount: d.employeeCount ?? null,
        email: d.email,
        phone: d.phone ?? null,
        website: d.website ?? null,
        address: d.address ?? null,
        timezone: d.timezone,
        currency: d.currency,
        status: "active",
      })
      .returning();

    // 2. Create admin user linked to this workspace
    const passwordHash = await bcrypt.hash(d.adminPassword, 12);
    const [adminUser] = await db
      .insert(usersTable)
      .values({
        email: d.adminEmail,
        firstName: d.adminFirstName,
        lastName: d.adminLastName,
        passwordHash,
        role: "admin",
        accountStatus: "active",
        isSuperAdmin: false,
        mustChangePassword: false,
        workspaceId: workspace.id,
      })
      .returning();

    // 2b. Seed default notification preferences for the new workspace admin
    await seedDefaultNotificationPrefs(adminUser.numId, workspace.id);

    // 3. Seed default pipeline stages for this workspace
    await db.insert(stagesTable).values(
      DEFAULT_STAGES.map(s => ({ ...s, workspaceId: workspace.id }))
    );

    // 4. Seed default RBAC roles for this workspace
    await seedWorkspaceRoles(workspace.id);

    // 4b. Link first user to the Super Admin role so they have full access
    const [superAdminRole] = await db
      .select({ id: rolesTable.id })
      .from(rolesTable)
      .where(and(eq(rolesTable.workspaceId, workspace.id), eq(rolesTable.name, "Super Admin")));

    if (superAdminRole) {
      await db
        .update(usersTable)
        .set({ roleId: superAdminRole.id })
        .where(eq(usersTable.numId, adminUser.numId));
      adminUser.roleId = superAdminRole.id;
    }

    // 5. Create session and log admin in immediately
    const sessionData: SessionData = {
      user: await dbUserToAuthUser(adminUser),
      workspaceId: workspace.id,
    };
    const sid = await createSession(sessionData);
    setSessionCookie(res, sid);

    logger.info({ workspaceId, adminEmail: d.adminEmail }, "New workspace created");

    res.status(201).json({
      workspace: {
        id: workspace.id,
        workspaceId: workspace.workspaceId,
        name: workspace.name,
        status: workspace.status,
      },
      user: sessionData.user,
    });
  } catch (err) {
    logger.error({ err }, "Workspace creation failed");
    res.status(500).json({ error: "Failed to create workspace. Please try again." });
  }
});

// Protected: get current workspace info
router.get("/workspaces/current", async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const wid = req.user.workspaceId;
  if (!wid) { res.json({ workspace: null }); return; }
  const [workspace] = await db.select().from(workspacesTable).where(eq(workspacesTable.id, wid));
  if (!workspace) { res.json({ workspace: null }); return; }
  const { webToLeadTokenHash, ...workspaceDetails } = workspace;
  res.json({ workspace: { ...workspaceDetails, webToLeadEnabled: Boolean(webToLeadTokenHash) } });
});

// Protected: explicitly provision or replace the workspace's public web-to-lead link.
router.post("/workspaces/current/web-to-lead-token", requirePermission("settings.edit"), async (req: Request, res: Response) => {
  if (!req.isAuthenticated() || req.user!.role !== "admin") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const workspaceId = req.user!.workspaceId;
  if (!workspaceId) { res.status(404).json({ error: "No workspace" }); return; }

  const token = createWebToLeadToken();
  const [workspace] = await db
    .update(workspacesTable)
    .set({ webToLeadTokenHash: hashWebToLeadToken(token) })
    .where(eq(workspacesTable.id, workspaceId))
    .returning({ id: workspacesTable.id });
  if (!workspace) { res.status(404).json({ error: "No workspace" }); return; }

  res.status(201).json({ token });
});

// Protected: update workspace info (admin only)
router.patch("/workspaces/current", requirePermission("settings.edit"), async (req: Request, res: Response) => {
  if (!req.isAuthenticated() || req.user!.role !== "admin") {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  const wid = req.user.workspaceId;
  if (!wid) { res.status(404).json({ error: "No workspace" }); return; }

  const UpdateWorkspaceBody = zod.object({
    name: zod.string().min(1).optional(),
    businessType: zod.string().optional(),
    industry: zod.string().optional(),
    employeeCount: zod.string().optional(),
    email: zod.string().email().optional(),
    phone: zod.string().optional(),
    website: zod.string().optional(),
    address: zod.string().optional(),
    timezone: zod.string().optional(),
    currency: zod.string().optional(),
    logoUrl: zod.string().optional(),
    customDomain: zod.string().optional(),
  });

  const parsed = UpdateWorkspaceBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid input" }); return; }

  const [updated] = await db
    .update(workspacesTable)
    .set(parsed.data)
    .where(eq(workspacesTable.id, wid))
    .returning();

  if (!updated) { res.status(404).json({ error: "No workspace" }); return; }
  const { webToLeadTokenHash, ...workspaceDetails } = updated;
  res.json({ workspace: { ...workspaceDetails, webToLeadEnabled: Boolean(webToLeadTokenHash) } });
});

export default router;
