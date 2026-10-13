import crypto from "crypto";
import { type Request, type Response } from "express";
import { db, sessionsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import type { AuthUser } from "@workspace/api-zod";

export const SESSION_COOKIE = "sid";
export const SESSION_TTL = 7 * 24 * 60 * 60 * 1000;      // 7 days absolute
export const IDLE_TIMEOUT_MS = 30 * 60 * 1000;             // 30 min idle
const TOUCH_DEBOUNCE_MS = 2 * 60 * 1000;                   // only write to DB every 2 min

export interface SessionData {
  user: AuthUser;
  workspaceId?: number | null;
  /** Development-only Quick Dev Login session; never grants privileges in production. */
  devLogin?: boolean;
  lastActivityAt?: number;
}

export async function createSession(data: SessionData): Promise<string> {
  const sid = crypto.randomBytes(32).toString("hex");
  const sessionWithActivity: SessionData = { ...data, lastActivityAt: Date.now() };
  await db.insert(sessionsTable).values({
    sid,
    sess: sessionWithActivity as unknown as Record<string, unknown>,
    expire: new Date(Date.now() + SESSION_TTL),
  });
  return sid;
}

export async function getSession(sid: string): Promise<SessionData | null> {
  const [row] = await db
    .select()
    .from(sessionsTable)
    .where(eq(sessionsTable.sid, sid));

  if (!row || row.expire < new Date()) {
    if (row) await deleteSession(sid);
    return null;
  }

  const data = row.sess as unknown as SessionData;

  // Enforce idle timeout
  if (data.lastActivityAt && Date.now() - data.lastActivityAt > IDLE_TIMEOUT_MS) {
    await deleteSession(sid);
    return null;
  }

  return data;
}

export async function touchSession(sid: string, currentData: SessionData): Promise<void> {
  const now = Date.now();
  if (currentData.lastActivityAt && now - currentData.lastActivityAt < TOUCH_DEBOUNCE_MS) {
    return;
  }
  const updated: SessionData = { ...currentData, lastActivityAt: now };
  await db
    .update(sessionsTable)
    .set({ sess: updated as unknown as Record<string, unknown> })
    .where(eq(sessionsTable.sid, sid));
}

export async function deleteSession(sid: string): Promise<void> {
  await db.delete(sessionsTable).where(eq(sessionsTable.sid, sid));
}

export async function deleteAllUserSessions(userId: number): Promise<void> {
  await db
    .delete(sessionsTable)
    .where(sql`(${sessionsTable.sess}->'user'->>'id')::int = ${userId}`);
}

export async function clearSession(res: Response, sid?: string): Promise<void> {
  if (sid) await deleteSession(sid);
  res.clearCookie(SESSION_COOKIE, { path: "/" });
}

export function getSessionId(req: Request): string | undefined {
  const authHeader = req.headers["authorization"];
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7);
  }
  return req.cookies?.[SESSION_COOKIE];
}
