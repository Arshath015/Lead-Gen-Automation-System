import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { pool } from "@workspace/db";
import { logger } from "../lib/logger";

const router: IRouter = Router();

function sendHealthCheck(_req: unknown, res: { json: (data: unknown) => void }) {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
}

// The artifact gateway probes the API mount path (/api), while the service
// health configuration uses /api/healthz. Keep both probes lightweight and
// independent of database availability.
router.get("/", sendHealthCheck);
router.get("/healthz", sendHealthCheck);

// Database readiness is intentionally separate: /healthz is the existing
// lightweight process liveness probe used by deployment monitoring.
router.get("/readyz", async (_req, res) => {
  const boundedQuery = async (sql: string): Promise<void> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        pool.query(sql),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("Database readiness timed out")), 2000);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  try {
    await boundedQuery("SELECT 1");
  } catch (err) {
    logger.warn({ err }, "Database readiness check failed");
    res.status(503).json({ status: "not_ready", database: "unavailable" });
    return;
  }
  try {
    // Refuse readiness when the code has been deployed before its additive
    // workspace token column. LIMIT 0 checks the column without reading rows.
    await boundedQuery("SELECT web_to_lead_token_hash FROM workspaces LIMIT 0");
    await boundedQuery("SELECT reminder_generation FROM followups LIMIT 0");
    await boundedQuery("SELECT email_status FROM followup_reminder_deliveries LIMIT 0");
    res.json({ status: "ready", database: "connected", schema: "compatible" });
  } catch (err) {
    logger.warn({ err }, "Required web-to-lead schema is not available");
    res.status(503).json({ status: "not_ready", database: "connected", schema: "incompatible" });
  }
});

export default router;
