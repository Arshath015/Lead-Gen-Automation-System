import { defineConfig } from "drizzle-kit";
import path from "path";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

export default defineConfig({
  // drizzle-kit treats this as a glob pattern internally — backslashes in a
  // Windows absolute path (and this repo's path containing a space) get
  // misread as glob escape characters, so the file silently fails to match.
  // Forward slashes work the same on Windows and sidestep that entirely.
  schema: path.join(__dirname, "./src/schema/index.ts").split(path.sep).join("/"),
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
