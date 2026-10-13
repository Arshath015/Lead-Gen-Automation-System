import { db, usersTable, workspacesTable, rolesTable, rolePermissionsTable, stagesTable } from "@workspace/db";
import { count, eq } from "drizzle-orm";

async function verify() {
  const [u] = await db.select({ c: count() }).from(usersTable);
  const [w] = await db.select({ c: count() }).from(workspacesTable);
  const [r] = await db.select({ c: count() }).from(rolesTable);
  const [p] = await db.select({ c: count() }).from(rolePermissionsTable).where(eq(rolePermissionsTable.allowed, true));
  const [s] = await db.select({ c: count() }).from(stagesTable);
  const admins = await db.select({
    email: usersTable.email, numId: usersTable.numId,
    roleId: usersTable.roleId, workspaceId: usersTable.workspaceId,
    isSuperAdmin: usersTable.isSuperAdmin, accountStatus: usersTable.accountStatus,
    role: usersTable.role,
  }).from(usersTable);

  console.log("\n📊 Database State:");
  console.log(`  Users:            ${u.c}`);
  console.log(`  Workspaces:       ${w.c}`);
  console.log(`  Roles:            ${r.c}`);
  console.log(`  Allowed perms:    ${p.c}`);
  console.log(`  Stages:           ${s.c}`);
  console.log("\n👤 Users:");
  for (const a of admins) console.log("  ", JSON.stringify(a));
  console.log();
}

verify().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
