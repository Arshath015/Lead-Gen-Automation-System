import EmbeddedPostgres from "embedded-postgres";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const databaseDir = path.join(__dirname, "..", "crm", ".localpg", "data");

const pg = new EmbeddedPostgres({
  databaseDir,
  user: "postgres",
  password: "postgres",
  port: 5544,
  persistent: true,
});

async function main() {
  // initialise() always runs initdb unconditionally and errors on a
  // non-empty dir — only run it the first time this cluster is created.
  const alreadyInitialised = fs.existsSync(path.join(databaseDir, "PG_VERSION"));
  if (!alreadyInitialised) await pg.initialise();
  await pg.start();
  console.log("LOCAL_PG_READY port=5544 db=postgres");

  try {
    await pg.createDatabase("crm");
    console.log("LOCAL_PG_DB_CREATED crm");
  } catch (err) {
    console.log("LOCAL_PG_DB_CREATE_SKIPPED", err.message);
  }

  console.log("LOCAL_PG_RUNNING");
}

main().catch((err) => {
  console.error("LOCAL_PG_FAILED", err);
  process.exit(1);
});

process.on("SIGINT", async () => {
  await pg.stop();
  process.exit(0);
});
