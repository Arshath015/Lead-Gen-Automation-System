import { db, teamMembersTable, usersTable, SYSTEM_ROLES } from "@workspace/db";
import { eq } from "drizzle-orm";

export type DataScope = {
  scope: "all" | "team" | "own";
  teamMemberIds: number[];
};

export type ScopeUser = {
  id: number;
  role: string;
  teamId?: number | null;
};

/**
 * Resolves the data scope for a given user.
 * - Roles with dataScope "all" in SYSTEM_ROLES (admin, finance, operations, etc.) → scope: "all"
 * - Manager → scope: "team", built from TWO sources (union, not either/or):
 *     1. teamId/teamMembersTable (explicit team assignment — legacy path, still supported)
 *     2. managerId field on users (direct reports — the actual reporting relationship)
 * - Everyone else → scope: "own"
 *
 * The "all" check is driven by SYSTEM_ROLES.dataScope so that any future role
 * with dataScope:"all" automatically gets org-wide read access without needing
 * another special-case here.
 */
export async function getDataScope(user: ScopeUser): Promise<DataScope> {
  const roleDef = SYSTEM_ROLES.find(r => r.key === user.role);
  const dataScope = roleDef?.dataScope ?? "own";

  if (dataScope === "all") {
    return { scope: "all", teamMemberIds: [] };
  }

  if (user.role === "manager") {
    const memberIds = new Set<number>();
    memberIds.add(user.id); // manager always sees their own leads

    // Path 1: team-based (explicit team membership table)
    if (user.teamId) {
      const teamMembers = await db
        .select({ userId: teamMembersTable.userId })
        .from(teamMembersTable)
        .where(eq(teamMembersTable.teamId, user.teamId));
      for (const m of teamMembers) memberIds.add(m.userId);
    }

    // Path 2: managerId-based (direct reports — users whose managerId = this manager's numId)
    const directReports = await db
      .select({ numId: usersTable.numId })
      .from(usersTable)
      .where(eq(usersTable.managerId, user.id));
    for (const r of directReports) memberIds.add(r.numId);

    return { scope: "team", teamMemberIds: Array.from(memberIds) };
  }

  return { scope: "own", teamMemberIds: [] };
}

/**
 * Resolves the set of user numIds whose leads the caller is allowed to see.
 * Returns null for "all" scope (no filter needed).
 */
export async function getAllowedOwnerIds(user: ScopeUser): Promise<number[] | null> {
  const { scope, teamMemberIds } = await getDataScope(user);
  if (scope === "all") return null;
  if (scope === "team") return teamMemberIds;
  return [user.id];
}
