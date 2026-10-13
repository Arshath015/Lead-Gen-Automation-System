import { Router, type IRouter, type Request, type Response } from "express";
import { db, leadsTable, stagesTable, activitiesTable, auditLogsTable, workspacesTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { buildWebToLeadLeadValues, hashWebToLeadToken, isWebToLeadTokenFormatValid, selectInitialLeadStage } from "../lib/web-to-lead";

const router: IRouter = Router();

const requestCounts = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 5;
const RATE_WINDOW = 60 * 1000;

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = requestCounts.get(ip);
  if (!entry || now > entry.resetAt) {
    requestCounts.set(ip, { count: 1, resetAt: now + RATE_WINDOW });
    return false;
  }
  entry.count++;
  return entry.count > RATE_LIMIT;
}

router.post("/public/leads", async (req: Request, res: Response) => {
  const ip = req.ip ?? "unknown";
  if (isRateLimited(ip)) {
    res.status(429).json({ error: "Too many requests. Please try again later." });
    return;
  }

  const { companyName, contactPerson, email, phone, location, industry, message, website_field, token } = req.body ?? {};

  if (!isWebToLeadTokenFormatValid(token)) {
    res.status(401).json({ error: "A valid web-to-lead link is required." });
    return;
  }

  const [workspace] = await db
    .select({ id: workspacesTable.id })
    .from(workspacesTable)
    .where(and(
      eq(workspacesTable.webToLeadTokenHash, hashWebToLeadToken(token)),
      eq(workspacesTable.status, "active"),
    ));
  if (!workspace) {
    res.status(401).json({ error: "This web-to-lead link is invalid or has been replaced." });
    return;
  }

  // Honeypot: if website_field has content, silently accept (it's a bot)
  if (website_field) {
    res.status(201).json({ message: "Thank you! We will be in touch soon." });
    return;
  }

  if (typeof companyName !== "string" || !companyName.trim() || typeof contactPerson !== "string" || !contactPerson.trim()) {
    res.status(400).json({ error: "Company name and contact person are required." });
    return;
  }

  const workspaceStages = await db
    .select()
    .from(stagesTable)
    .where(eq(stagesTable.workspaceId, workspace.id));
  const defaultStage = selectInitialLeadStage(workspaceStages, workspace.id);
  if (!defaultStage) {
    res.status(503).json({ error: "This workspace does not have a default lead stage configured." });
    return;
  }

  const [lead] = await db.insert(leadsTable).values({
    ...buildWebToLeadLeadValues(
      { companyName, contactPerson, email, phone, location, industry, message },
      workspace.id,
      defaultStage.id,
    ),
  }).returning();

  await db.insert(activitiesTable).values({
    leadId: lead.id,
    type: "created",
    description: "Lead submitted via web form",
    userId: null,
    workspaceId: workspace.id,
  }).catch(() => {});

  await db.insert(auditLogsTable).values({
    leadId: lead.id,
    userId: null,
    action: "web_form_submit",
    tableName: "leads",
    fieldName: null,
    oldValue: null,
    newValue: lead.companyName,
    ipAddress: ip,
    workspaceId: workspace.id,
  }).catch(() => {});

  res.status(201).json({ message: "Thank you! We will be in touch soon." });
});

export default router;
