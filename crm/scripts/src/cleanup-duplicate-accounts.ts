/**
 * cleanup-duplicate-accounts.ts
 *
 * Finds accounts in the same workspace that share an identical name —
 * a symptom of the same lead being converted multiple times before the
 * dedup guard was added.
 *
 * Usage (dry-run, safe — default):
 *   pnpm --filter @workspace/scripts tsx src/cleanup-duplicate-accounts.ts
 *
 * Usage (actually delete):
 *   pnpm --filter @workspace/scripts tsx src/cleanup-duplicate-accounts.ts --execute
 *
 * Strategy: for each group of duplicate accounts with the same
 * (workspaceId, name), keep the OLDEST record (lowest id) and delete the rest.
 * Deals / contacts that reference a deleted account will have their accountId
 * set to the surviving account via UPDATE before the deletes.
 */

import "dotenv/config";
import { db } from "@workspace/db";
import { accountsTable, dealsTable, contactsTable } from "@workspace/db";
import { eq, sql, and } from "drizzle-orm";

const EXECUTE = process.argv.includes("--execute");

async function main() {
  console.log(`\n=== Duplicate Account Cleanup (${EXECUTE ? "EXECUTE" : "DRY RUN"}) ===\n`);

  // Find all (workspaceId, name) pairs that have more than one row
  const dupes = await db
    .select({
      workspaceId: accountsTable.workspaceId,
      name: accountsTable.name,
      count: sql<number>`count(*)::int`,
      minId: sql<number>`min(id)::int`,
      allIds: sql<number[]>`array_agg(id order by id)`,
    })
    .from(accountsTable)
    .groupBy(accountsTable.workspaceId, accountsTable.name)
    .having(sql`count(*) > 1`);

  if (dupes.length === 0) {
    console.log("✓ No duplicate accounts found — nothing to do.");
    return;
  }

  console.log(`Found ${dupes.length} duplicate group(s):\n`);

  let totalToDelete = 0;
  for (const group of dupes) {
    const keepId = group.minId;
    const deleteIds = group.allIds.filter((id: number) => id !== keepId);
    totalToDelete += deleteIds.length;

    console.log(`  Workspace ${group.workspaceId ?? "null"} | "${group.name}"`);
    console.log(`    Keep   → id ${keepId}`);
    console.log(`    Delete → ids [${deleteIds.join(", ")}] (${deleteIds.length} duplicate${deleteIds.length !== 1 ? "s" : ""})`);

    if (!EXECUTE) continue;

    // Re-point any Deals referencing a deleted account → surviving account
    for (const delId of deleteIds) {
      const dealsUpdated = await db
        .update(dealsTable)
        .set({ accountId: keepId })
        .where(eq(dealsTable.accountId, delId));
      // Re-point any Contacts
      const contactsUpdated = await db
        .update(contactsTable)
        .set({ accountId: keepId })
        .where(eq(contactsTable.accountId, delId));
    }

    // Delete the duplicate rows
    for (const delId of deleteIds) {
      await db.delete(accountsTable).where(eq(accountsTable.id, delId));
      console.log(`    ✓ Deleted account id ${delId}, re-pointed its deals/contacts → ${keepId}`);
    }
  }

  if (!EXECUTE) {
    console.log(`\nDRY RUN complete. ${totalToDelete} duplicate account(s) would be deleted.`);
    console.log("Re-run with --execute to apply.\n");
  } else {
    console.log(`\n✓ Done. ${totalToDelete} duplicate account(s) deleted.\n`);
  }
}

main().catch(err => {
  console.error("Script failed:", err);
  process.exit(1);
});
