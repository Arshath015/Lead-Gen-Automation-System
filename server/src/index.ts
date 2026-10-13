import express from "express";
import cors from "cors";
import { env } from "./config/env";
import { resolveDataDir } from "./db/sqlite";
import { ensureDatabaseInitialized } from "./db/migrateJsonToSqlite";
import { icpRouter } from "./routes/icp.routes";
import { searchRouter } from "./routes/search.routes";
import { leadsRouter } from "./routes/leads.routes";
import { researchRouter } from "./routes/research.routes";
import { emailDraftsRouter } from "./routes/emailDrafts.routes";
import { configRouter } from "./routes/config.routes";
import { automationRouter } from "./routes/automation.routes";
import { webhooksRouter } from "./routes/webhooks.routes";
import { engagementEventsRouter } from "./routes/engagementEvents.routes";
import { analyticsRouter } from "./routes/analytics.routes";
import { signatureImagesRouter } from "./routes/signatureImages.routes";
import { attachmentsRouter } from "./routes/attachments.routes";
import { connectorsRouter } from "./routes/connectors.routes";
import { importRouter } from "./routes/import.routes";
import { startAutomationScheduler } from "./automation/scheduler";

// Must run before anything else touches the database, and before the app
// accepts any requests — see ensureDatabaseInitialized's own comment
// (db/migrateJsonToSqlite.ts) for the exact incident this guards against.
// Throws (and so refuses to start the server at all) if the database is
// unexpectedly empty relative to the JSON backup AND the automatic recovery
// migration itself fails validation — never silently serves an empty/wrong
// leads table.
ensureDatabaseInitialized(resolveDataDir());

const app = express();

app.use(cors());
// Captures the exact raw bytes of every request body alongside the parsed
// JSON, since webhook signature verification (Resend/Svix) needs the
// original bytes — re-serializing req.body would not reliably reproduce them.
app.use(
  express.json({
    verify: (req, _res, buf) => {
      (req as express.Request).rawBody = buf.toString("utf-8");
    },
  })
);

app.get("/api/health", (_req, res) => res.json({ ok: true }));
app.use("/api/icp-profiles", icpRouter);
app.use("/api/search", searchRouter);
app.use("/api/leads", leadsRouter);
app.use("/api/research", researchRouter);
app.use("/api/email-drafts", emailDraftsRouter);
app.use("/api/config", configRouter);
app.use("/api/automation", automationRouter);
app.use("/api/webhooks", webhooksRouter);
app.use("/api/engagement-events", engagementEventsRouter);
app.use("/api/analytics", analyticsRouter);
app.use("/api/signature-images", signatureImagesRouter);
app.use("/api/attachments", attachmentsRouter);
app.use("/api/connectors", connectorsRouter);
app.use("/api/import", importRouter);

app.listen(env.port, () => {
  console.log(`Server listening on http://localhost:${env.port}`);
  startAutomationScheduler();
});
