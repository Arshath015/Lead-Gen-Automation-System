import { db, followupsTable } from "@workspace/db";
import { desc } from "drizzle-orm";

async function main() {
  const rows = await db
    .select()
    .from(followupsTable)
    .orderBy(desc(followupsTable.createdAt))
    .limit(5);

  console.log("--- Most recent followups (raw DB values) ---");
  for (const r of rows) {
    const stored = r.scheduledAt as Date;
    const utcStr = stored.toISOString();
    // What date-fns parseISO + format(local) does in a browser:
    // parseISO gives the UTC instant; format() renders in browser-local time.
    // In IST (+5:30) that means UTC+5h30m displayed.
    const istMs = stored.getTime() + 5.5 * 3600 * 1000;
    const istDate = new Date(istMs);
    console.log(
      JSON.stringify(
        {
          id: r.id,
          leadId: r.leadId,
          "DB storedUTC": utcStr,
          "→ displayed in IST browser": istDate.toISOString().slice(0, 16).replace("T", " ") + " IST",
          createdAt: r.createdAt.toISOString(),
        },
        null,
        2
      )
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
