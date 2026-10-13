import crypto from "crypto";
import bcrypt from "bcryptjs";
import rateLimit from "express-rate-limit";
import { Router, type IRouter, type Request, type Response } from "express";
import { db, usersTable, rolesTable, workspacesTable, stagesTable, loginHistoryTable, auditLogsTable } from "@workspace/db";
import { resolvePermissions, seedWorkspaceRoles } from "../lib/permissions";
import { and, eq, sql } from "drizzle-orm";
import { isQuickDevLoginEnabled } from "../lib/dev-login-guard";
import * as zod from "zod";
import {
  clearSession,
  getSessionId,
  createSession,
  deleteAllUserSessions,
  SESSION_COOKIE,
  SESSION_TTL,
  type SessionData,
} from "../lib/auth";
import { sendNewSignupNotification, sendPasswordResetEmail } from "../lib/email";
import { getAppUrl } from "../lib/app-url";
import { seedDefaultNotificationPrefs } from "../lib/seedDefaultNotificationPrefs";

// ── Password complexity schema ────────────────────────────────────────────────
// Reused by all password-setting endpoints.
const PasswordSchema = zod
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(128, "Password must not exceed 128 characters")
  .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
  .regex(/[0-9]/, "Password must contain at least one number")
  .regex(/[^a-zA-Z0-9]/, "Password must contain at least one special character");

const LoginBody = zod.object({
  email: zod.string().email().toLowerCase().trim(),
  password: zod.string().min(1).max(256),
});

const SetupBody = zod.object({
  firstName: zod.string().min(1).max(100).trim(),
  lastName: zod.string().min(1).max(100).trim(),
  email: zod.string().email().toLowerCase().trim(),
  password: PasswordSchema,
});

const SignupBody = zod.object({
  firstName: zod.string().min(1, "First name is required").max(100).trim(),
  lastName: zod.string().min(1, "Last name is required").max(100).trim(),
  email: zod.string().email("Invalid email").toLowerCase().trim(),
  password: PasswordSchema,
  confirmPassword: zod.string(),
  company: zod.string().max(200).optional(),
  requestedRole: zod.enum(["manager", "bd"]).default("bd"),
}).refine(d => d.password === d.confirmPassword, {
  message: "Passwords do not match",
  path: ["confirmPassword"],
});

// ── Rate limiters (per-route) ─────────────────────────────────────────────────
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many login attempts. Please try again later." },
});

const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many registration attempts. Please try again later." },
});

const forgotPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many password reset requests. Please try again later." },
});

const resetPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many requests. Please try again later." },
});

const router: IRouter = Router();

function setSessionCookie(res: Response, sid: string) {
  res.cookie(SESSION_COOKIE, sid, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL,
  });
}

export async function dbUserToAuthUser(user: typeof usersTable.$inferSelect) {
  const username =
    user.email?.split("@")[0] ??
    (`${user.firstName ?? ""}${user.lastName ?? ""}`.replace(/\s/g, "").toLowerCase() || `user${user.numId}`);

  let roleId = user.roleId ?? null;
  if (!roleId) {
    const [roleRow] = await db
      .select({ id: rolesTable.id })
      .from(rolesTable)
      .where(
        eq(
          rolesTable.name,
          user.role === "admin" ? "Admin" : user.role === "manager" ? "Sales Manager" : "Sales Person",
        ),
      );
    roleId = roleRow?.id ?? null;
  }

  return {
    id: user.numId,
    replitId: user.id,
    username,
    firstName: user.firstName ?? null,
    lastName: user.lastName ?? null,
    email: user.email ?? null,
    profileImage: user.profileImageUrl ?? null,
    role: user.role,
    roleId,
    teamId: user.teamId ?? null,
    managerId: user.managerId ?? null,
    targetAmount: user.targetAmount ?? null,
    isAuthenticated: true,
    isSuperAdmin: user.isSuperAdmin ?? false,
  };
}

// ── Password history helpers ──────────────────────────────────────────────────
const PASSWORD_HISTORY_DEPTH = 5;

async function isPasswordInHistory(newPassword: string, history: string[]): Promise<boolean> {
  for (const hash of history.slice(-PASSWORD_HISTORY_DEPTH)) {
    if (await bcrypt.compare(newPassword, hash)) return true;
  }
  return false;
}

async function setPasswordWithHistory(
  userId: number,
  currentHash: string | null,
  newHash: string,
  currentHistory: string[],
): Promise<void> {
  const updatedHistory = [
    ...currentHistory,
    ...(currentHash ? [currentHash] : []),
  ].slice(-PASSWORD_HISTORY_DEPTH);
  await db
    .update(usersTable)
    .set({ passwordHash: newHash, passwordHistory: updatedHistory })
    .where(eq(usersTable.numId, userId));
}

// Public: check if first-run setup is needed
router.get("/auth/setup-needed", async (_req: Request, res: Response) => {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(usersTable);
  res.json({ needsSetup: (row?.count ?? 0) === 0 });
});

// Public: create the first admin account (only when no users exist)
router.post("/auth/setup", async (req: Request, res: Response) => {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(usersTable);
  if ((row?.count ?? 0) > 0) {
    res.status(403).json({ error: "Setup already complete" });
    return;
  }

  const parsed = SetupBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }

  const { firstName, lastName, email, password } = parsed.data;
  req.log.info({ email, passwordLen: password.length }, "[setup] hashing password");
  const passwordHash = await bcrypt.hash(password, 12);
  req.log.info({ email, hashPrefix: passwordHash.slice(0, 7) }, "[setup] password hashed");

  // 1. Create a default workspace for this installation
  const workspaceId = "ws_" + crypto.randomBytes(5).toString("hex");
  const [workspace] = await db
    .insert(workspacesTable)
    .values({
      workspaceId,
      name: `${firstName} ${lastName}'s Workspace`,
      status: "active",
      timezone: "UTC",
      currency: "USD",
    })
    .returning();

  // 2. Create the Super Admin user linked to this workspace
  const [user] = await db
    .insert(usersTable)
    .values({
      email,
      firstName,
      lastName,
      passwordHash,
      role: "admin",
      accountStatus: "active",
      isSuperAdmin: true,
      workspaceId: workspace.id,
    })
    .returning();

  // 2b. Seed default notification preferences for the new admin
  await seedDefaultNotificationPrefs(user.numId, user.workspaceId ?? null);

  // 3. Seed default pipeline stages
  const DEFAULT_STAGES = [
    { name: "New Lead",      color: "#6366f1", order: 0, isDefault: true,  isWon: false, isLost: false },
    { name: "Contacted",     color: "#06b6d4", order: 1, isDefault: false, isWon: false, isLost: false },
    { name: "Qualified",     color: "#8b5cf6", order: 2, isDefault: false, isWon: false, isLost: false },
    { name: "Proposal Sent", color: "#f59e0b", order: 3, isDefault: false, isWon: false, isLost: false },
    { name: "Negotiation",   color: "#f97316", order: 4, isDefault: false, isWon: false, isLost: false },
    { name: "Won",           color: "#22c55e", order: 5, isDefault: false, isWon: true,  isLost: false },
    { name: "Lost",          color: "#ef4444", order: 6, isDefault: false, isWon: false, isLost: true  },
  ];
  await db.insert(stagesTable).values(DEFAULT_STAGES.map(s => ({ ...s, workspaceId: workspace.id })));

  // 4. Seed all default RBAC roles for this workspace
  await seedWorkspaceRoles(workspace.id);

  // 5. Link this user to the Super Admin role
  const [superAdminRole] = await db
    .select({ id: rolesTable.id })
    .from(rolesTable)
    .where(and(eq(rolesTable.workspaceId, workspace.id), eq(rolesTable.name, "Super Admin")));

  if (superAdminRole) {
    await db.update(usersTable).set({ roleId: superAdminRole.id }).where(eq(usersTable.numId, user.numId));
    user.roleId = superAdminRole.id;
  }

  const sessionData: SessionData = { user: await dbUserToAuthUser(user), workspaceId: workspace.id };
  const sid = await createSession(sessionData);
  setSessionCookie(res, sid);
  res.status(201).json({ user: sessionData.user, mustChangePassword: false });
});

// Public: self sign-up — creates a Pending account awaiting admin approval
router.post("/auth/signup", signupLimiter, async (req: Request, res: Response) => {
  const parsed = SignupBody.safeParse(req.body);
  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message ?? "Invalid input";
    res.status(400).json({ error: msg });
    return;
  }

  const { firstName, lastName, email, password, company, requestedRole } = parsed.data;

  const [existing] = await db.select({ id: usersTable.numId }).from(usersTable).where(eq(usersTable.email, email));
  if (existing) {
    // Don't confirm email existence — generic message
    res.status(409).json({ error: "An account with this email already exists" });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  await db.insert(usersTable).values({
    email,
    firstName,
    lastName,
    passwordHash,
    role: "bd",
    accountStatus: "pending",
    company: company ?? null,
    requestedRole,
  });

  const fullName = `${firstName} ${lastName}`;
  sendNewSignupNotification(fullName, email, requestedRole).catch(() => {});

  res.status(201).json({ message: "Account request submitted. You will be notified when approved." });
});

// Get current authenticated user
router.get("/auth/user", async (req: Request, res: Response) => {
  res.set("Cache-Control", "no-store");
  if (!req.isAuthenticated()) {
    res.json({ user: null });
    return;
  }
  const [dbUser] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.numId, req.user.id));
  if (!dbUser) {
    res.json({ user: null });
    return;
  }
  const devLogin = process.env.NODE_ENV !== "production" && req.user.devLogin === true;
  const authUser = await dbUserToAuthUser(dbUser);
  if (devLogin) {
    authUser.role = "admin";
    authUser.isSuperAdmin = true;
  }
  const workspaceId = devLogin ? (req.user.workspaceId ?? null) : dbUser.workspaceId;
  const isSuperAdmin = devLogin ? true : (dbUser.isSuperAdmin ?? false);
  const permSet = await resolvePermissions(dbUser.numId, workspaceId, isSuperAdmin);
  res.json({
    user: { ...authUser, permissions: Array.from(permSet) },
    mustChangePassword: dbUser.mustChangePassword,
  });
});

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_DURATION_MS = 30 * 60 * 1000; // 30 minutes

async function recordLoginHistory(
  userId: number | null,
  email: string,
  req: Request,
  success: boolean,
  failureReason?: string,
) {
  await db.insert(loginHistoryTable).values({
    userId,
    email,
    ipAddress: (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ?? req.ip ?? null,
    userAgent: req.headers["user-agent"] ?? null,
    success,
    failureReason: failureReason ?? null,
  }).catch(() => {});
}

// Login with email + password
router.post("/auth/login", loginLimiter, async (req: Request, res: Response) => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Email and password are required" });
    return;
  }

  const { email, password } = parsed.data;
  // Quick Dev Login uses a session-only elevation. Never allow its reserved
  // account to authenticate through the normal password flow, including when
  // a development database is accidentally connected to a deployment.
  if (email === "demo@rapport.dev") {
    await bcrypt.compare(password, "$2a$12$notavalidhashbutkeepstiming000000000000000000000000");
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }
  req.log.info({ email, passwordLen: password.length }, "[login] attempt");

  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email));

  req.log.info({
    email,
    found: !!user,
    hasHash: !!user?.passwordHash,
    hashPrefix: user?.passwordHash ? user.passwordHash.slice(0, 7) : null,
    accountStatus: user?.accountStatus ?? null,
    failedCount: user?.failedLoginCount ?? null,
    lockedUntil: user?.lockedUntil ?? null,
  }, "[login] user lookup result");

  if (!user || !user.passwordHash) {
    await recordLoginHistory(null, email, req, false, "user_not_found");
    // Constant-time dummy compare to prevent timing attacks
    await bcrypt.compare(password, "$2a$12$notavalidhashbutkeepstiming00000000000000000000000000");
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  // Check if account is temporarily locked
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    const minutesLeft = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
    await recordLoginHistory(user.numId, email, req, false, "account_locked");
    res.status(423).json({ error: `Account is temporarily locked due to too many failed attempts. Try again in ${minutesLeft} minute${minutesLeft !== 1 ? "s" : ""}.` });
    return;
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  req.log.info({ email, valid, passwordLen: password.length }, "[login] bcrypt comparison result");
  if (!valid) {
    const newCount = (user.failedLoginCount ?? 0) + 1;
    const shouldLock = newCount >= MAX_FAILED_ATTEMPTS;
    await db.update(usersTable).set({
      failedLoginCount: newCount,
      lockedUntil: shouldLock ? new Date(Date.now() + LOCK_DURATION_MS) : null,
    }).where(eq(usersTable.numId, user.numId));
    await recordLoginHistory(user.numId, email, req, false, "invalid_password");
    if (shouldLock) {
      res.status(423).json({ error: `Too many failed attempts. Your account has been locked for 30 minutes.` });
    } else {
      const remaining = MAX_FAILED_ATTEMPTS - newCount;
      res.status(401).json({ error: `Invalid email or password. ${remaining} attempt${remaining !== 1 ? "s" : ""} remaining before lockout.` });
    }
    return;
  }

  // Check account status
  if (user.accountStatus === "pending") {
    await recordLoginHistory(user.numId, email, req, false, "pending_approval");
    res.status(403).json({ error: "Your account is pending admin approval. You will be notified by email when approved." });
    return;
  }
  if (user.accountStatus === "rejected") {
    await recordLoginHistory(user.numId, email, req, false, "rejected");
    res.status(403).json({ error: "Your account request was not approved. Please contact your administrator." });
    return;
  }
  if (user.accountStatus === "disabled") {
    await recordLoginHistory(user.numId, email, req, false, "disabled");
    res.status(403).json({ error: "Your account has been disabled. Please contact your administrator." });
    return;
  }

  // Successful login — reset failed count
  const ip = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ?? req.ip ?? null;
  await db.update(usersTable).set({
    failedLoginCount: 0,
    lockedUntil: null,
    lastLoginAt: new Date(),
    lastLoginIp: ip,
  }).where(eq(usersTable.numId, user.numId));
  await recordLoginHistory(user.numId, email, req, true);

  const sessionData: SessionData = { user: await dbUserToAuthUser(user), workspaceId: user.workspaceId ?? null };
  const sid = await createSession(sessionData);
  setSessionCookie(res, sid);
  res.json({ user: sessionData.user, mustChangePassword: user.mustChangePassword });
});

// Logout — clear current session
router.post("/auth/logout", async (req: Request, res: Response) => {
  if (req.isAuthenticated()) {
    await db.insert(auditLogsTable).values({
      leadId: null,
      userId: req.user.id,
      action: "logout",
      tableName: "sessions",
      fieldName: null,
      oldValue: null,
      newValue: "Session terminated",
      ipAddress: req.ip ?? null,
      workspaceId: req.user.workspaceId ?? null,
    }).catch(() => {});
  }
  const sid = getSessionId(req);
  await clearSession(res, sid);
  res.json({ success: true });
});

// Logout from all devices — invalidates every session for this user
router.post("/auth/logout-all-devices", async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  await deleteAllUserSessions(req.user.id);
  await db.insert(auditLogsTable).values({
    leadId: null,
    userId: req.user.id,
    action: "logout_all_devices",
    tableName: "sessions",
    fieldName: null,
    oldValue: null,
    newValue: "All sessions revoked",
    ipAddress: req.ip ?? null,
    workspaceId: req.user.workspaceId ?? null,
  }).catch(() => {});
  res.clearCookie(SESSION_COOKIE, { path: "/" });
  res.json({ success: true });
});

// Forgot password — send reset link
router.post("/auth/forgot-password", forgotPasswordLimiter, async (req: Request, res: Response) => {
  const parsed = zod.object({ email: zod.string().email().toLowerCase().trim() }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Valid email required" });
    return;
  }

  const { email } = parsed.data;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email));

  // Always respond with success to prevent email enumeration
  if (!user || user.accountStatus !== "active") {
    res.json({ message: "If an active account exists for that email, a reset link has been sent." });
    return;
  }

  let appUrl: string;
  try {
    appUrl = getAppUrl();
  } catch (err) {
    req.log?.error({ err }, "Password reset link origin is not configured");
    res.status(503).json({ error: "Password reset is temporarily unavailable" });
    return;
  }

  const token = crypto.randomBytes(32).toString("hex");
  const expiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

  await db.update(usersTable)
    .set({ passwordResetToken: token, passwordResetExpiry: expiry })
    .where(eq(usersTable.numId, user.numId));

  const resetUrl = `${appUrl}/reset-password?token=${token}`;

  sendPasswordResetEmail(email, resetUrl).catch(() => {});
  res.json({ message: "If an active account exists for that email, a reset link has been sent." });
});

// Reset password with a valid token
router.post("/auth/reset-password", resetPasswordLimiter, async (req: Request, res: Response) => {
  const parsed = zod.object({
    token: zod.string().min(1).max(128),
    newPassword: PasswordSchema,
  }).safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }

  const { token, newPassword } = parsed.data;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.passwordResetToken, token));

  if (!user || !user.passwordResetExpiry || user.passwordResetExpiry < new Date()) {
    res.status(400).json({ error: "Invalid or expired reset link. Please request a new one." });
    return;
  }

  // Password history check
  const history = (user.passwordHistory as string[] | null) ?? [];
  if (await isPasswordInHistory(newPassword, history)) {
    res.status(400).json({ error: `You cannot reuse any of your last ${PASSWORD_HISTORY_DEPTH} passwords. Please choose a new password.` });
    return;
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);
  await setPasswordWithHistory(user.numId, user.passwordHash ?? null, passwordHash, history);
  await db.update(usersTable)
    .set({ passwordResetToken: null, passwordResetExpiry: null, mustChangePassword: false })
    .where(eq(usersTable.numId, user.numId));

  // Invalidate all sessions (password changed — force re-login on other devices)
  await deleteAllUserSessions(user.numId);

  await db.insert(auditLogsTable).values({
    leadId: null,
    userId: user.numId,
    action: "password_reset",
    tableName: "users",
    fieldName: "passwordHash",
    oldValue: null,
    newValue: "Password reset via token",
    ipAddress: req.ip ?? null,
    workspaceId: user.workspaceId ?? null,
  }).catch(() => {});

  res.json({ success: true });
});

// Force-change password (mustChangePassword flag) — no current password required
router.post("/auth/force-change-password", async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }

  const parsed = zod.object({
    newPassword: PasswordSchema,
  }).safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.numId, req.user.id));
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  const history = (user.passwordHistory as string[] | null) ?? [];
  if (await isPasswordInHistory(parsed.data.newPassword, history)) {
    res.status(400).json({ error: `You cannot reuse any of your last ${PASSWORD_HISTORY_DEPTH} passwords.` });
    return;
  }

  const passwordHash = await bcrypt.hash(parsed.data.newPassword, 12);
  await setPasswordWithHistory(user.numId, user.passwordHash ?? null, passwordHash, history);
  await db.update(usersTable)
    .set({ mustChangePassword: false })
    .where(eq(usersTable.numId, req.user.id));

  await db.insert(auditLogsTable).values({
    leadId: null,
    userId: req.user.id,
    action: "force_password_changed",
    tableName: "users",
    fieldName: "passwordHash",
    oldValue: null,
    newValue: "Password updated via forced change",
    ipAddress: req.ip ?? null,
    workspaceId: req.user.workspaceId ?? null,
  }).catch(() => {});

  res.json({ success: true });
});

// Change password (requires current password)
router.post("/auth/change-password", resetPasswordLimiter, async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }

  const parsed = zod.object({
    currentPassword: zod.string().min(1).max(256),
    newPassword: PasswordSchema,
  }).safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.numId, req.user.id));
  if (!user || !user.passwordHash) {
    res.status(400).json({ error: "No password set for this account" });
    return;
  }

  const valid = await bcrypt.compare(parsed.data.currentPassword, user.passwordHash);
  if (!valid) {
    res.status(401).json({ error: "Current password is incorrect" });
    return;
  }

  const history = (user.passwordHistory as string[] | null) ?? [];
  if (await isPasswordInHistory(parsed.data.newPassword, history)) {
    res.status(400).json({ error: `You cannot reuse any of your last ${PASSWORD_HISTORY_DEPTH} passwords.` });
    return;
  }

  const passwordHash = await bcrypt.hash(parsed.data.newPassword, 12);
  await setPasswordWithHistory(user.numId, user.passwordHash, passwordHash, history);
  await db.update(usersTable)
    .set({ mustChangePassword: false })
    .where(eq(usersTable.numId, req.user.id));

  // Invalidate all other sessions after password change
  const currentSid = getSessionId(req);
  await deleteAllUserSessions(req.user.id);
  // Re-create a session for the current device so the user stays logged in
  if (currentSid) {
    const [updatedUser] = await db.select().from(usersTable).where(eq(usersTable.numId, req.user.id));
    if (updatedUser) {
      const sessionData: SessionData = { user: await dbUserToAuthUser(updatedUser), workspaceId: req.user.workspaceId ?? null };
      const newSid = await createSession(sessionData);
      setSessionCookie(res, newSid);
    }
  }

  await db.insert(auditLogsTable).values({
    leadId: null,
    userId: req.user.id,
    action: "password_changed",
    tableName: "users",
    fieldName: "passwordHash",
    oldValue: null,
    newValue: "Password changed by user",
    ipAddress: req.ip ?? null,
    workspaceId: req.user.workspaceId ?? null,
  }).catch(() => {});

  res.json({ success: true });
});

// Dev-only instant login — never runs in production
router.get("/dev-login", async (req: Request, res: Response) => {
  if (!isQuickDevLoginEnabled()) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const demoEmail = "demo@rapport.dev";
  const devWorkspaceId = Number(process.env.DEV_LOGIN_WORKSPACE_ID);
  const [workspace] = await db
    .select({ id: workspacesTable.id })
    .from(workspacesTable)
    .where(and(eq(workspacesTable.status, "active"), eq(workspacesTable.id, devWorkspaceId)))
    .limit(1);
  if (!workspace) {
    res.status(503).json({ error: "Quick Dev Login requires an active development workspace." });
    return;
  }

  const existing = await db.select().from(usersTable).where(eq(usersTable.email, demoEmail));
  let user: typeof usersTable.$inferSelect;
  if (existing.length === 0) {
    const passwordHash = await bcrypt.hash(crypto.randomBytes(32).toString("hex"), 10);
    const [created] = await db
      .insert(usersTable)
      .values({ email: demoEmail, firstName: "Demo", lastName: "Admin", passwordHash, role: "bd", accountStatus: "active" })
      .returning();
    user = created;
  } else {
    user = existing[0];
    if (user.accountStatus !== "active") {
      res.status(403).json({ error: "The development demo account is not active." });
      return;
    }
  }

  const sessionUser = await dbUserToAuthUser(user);
  // Grant the demo role and workspace only in this opaque, development-only
  // session. Do not rewrite the demo user's persisted role or workspace.
  sessionUser.role = "admin";
  sessionUser.isSuperAdmin = true;
  const sessionData: SessionData = {
    user: sessionUser,
    workspaceId: workspace.id,
    devLogin: true,
  };
  const sid = await createSession(sessionData);
  res.set("Cache-Control", "no-store");
  res.json({ sid });
});

export default router;
