import { type Request, type Response, type NextFunction } from "express";
import { clearSession, getSessionId, getSession, touchSession } from "../lib/auth";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { isQuickDevLoginEnabled } from "../lib/dev-login-guard";

declare global {
  namespace Express {
    interface User {
      id: number;
      replitId: string;
      username: string;
      firstName?: string | null;
      lastName?: string | null;
      email?: string | null;
      profileImage?: string | null;
      role?: "admin" | "manager" | "bd";
      roleId?: number | null;
      teamId?: number | null;
      managerId?: number | null;
      targetAmount?: string | null;
      isAuthenticated?: boolean;
      workspaceId?: number | null;
      isSuperAdmin?: boolean;
      devLogin?: boolean;
    }

    interface Request {
      isAuthenticated(): this is AuthedRequest;
      user?: User | undefined;
      sessionId?: string;
    }

    export interface AuthedRequest {
      user: User;
    }
  }
}

export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  req.isAuthenticated = function (this: Request) {
    return this.user != null;
  } as Request["isAuthenticated"];

  const sid = getSessionId(req);
  if (!sid) { next(); return; }

  const session = await getSession(sid);
  if (!session || !(session.user as Express.User | undefined)?.id) {
    await clearSession(res, sid);
    next();
    return;
  }
  if (session.devLogin && !isQuickDevLoginEnabled()) {
    await clearSession(res, sid);
    next();
    return;
  }

  // Re-check account status AND isSuperAdmin on every request.
  // isSuperAdmin is read live from the DB (not from the session) so that a
  // repair (e.g. seedSuperAdmin setting isSuperAdmin=true) takes effect on the
  // very next request without requiring the user to log out and back in.
  const [dbUser] = await db
    .select({ accountStatus: usersTable.accountStatus, isSuperAdmin: usersTable.isSuperAdmin })
    .from(usersTable)
    .where(eq(usersTable.numId, (session.user as Express.User).id));

  if (!dbUser || dbUser.accountStatus !== "active") {
    await clearSession(res, sid);
    next();
    return;
  }

  req.user = session.user as Express.User;
  req.user.workspaceId = session.workspaceId ?? null;
  req.user.devLogin = isQuickDevLoginEnabled() && session.devLogin === true;
  // Always use the live DB value so stale sessions never block a legitimate super-admin
  req.user.isSuperAdmin = req.user.devLogin ? true : (dbUser.isSuperAdmin ?? false);
  req.sessionId = sid;

  // Rolling session: debounced DB write so idle timeout stays accurate
  touchSession(sid, session).catch(() => {});

  next();
}
