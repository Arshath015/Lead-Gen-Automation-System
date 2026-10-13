import { Router, type IRouter, type Request, type Response } from "express";
import { db, leadsTable, stagesTable, importJobsTable, importMappingTemplatesTable, auditLogsTable } from "@workspace/db";
import { eq, and, inArray, desc } from "drizzle-orm";
import { z } from "zod";
import { wsFilter } from "../lib/workspaceScope";
import { requirePermission } from "../lib/permissions";
import { getDefaultExtractor } from "../lib/entity-extraction";

const router: IRouter = Router();

const AnalyzeImportBodySchema = z.object({
  headers: z.array(z.string()),
  sampleRows: z.array(z.record(z.string())),
  totalRows: z.number().optional(),
  fileHash: z.string().nullable().optional(),
});

const FieldMappingSchema = z.object({
  sourceColumn: z.string(),
  suggestedField: z.string().nullable(),
  confidence: z.number(),
  isCombined: z.boolean(),
  combinedFields: z.array(z.string()),
  detectionMethod: z.string(),
  sampleValues: z.array(z.string()),
});

const ValidateImportBodySchema = z.object({
  rows: z.array(z.record(z.string())),
  mappings: z.array(FieldMappingSchema),
});

const ExecuteImportBodySchema = z.object({
  rows: z.array(z.record(z.string())),
  mappings: z.array(FieldMappingSchema),
  duplicateAction: z.enum(["skip", "update", "import_anyway"]).default("skip"),
  fileName: z.string().optional(),
  fileHash: z.string().nullable().optional(),
});

const CreateMappingTemplateSchema = z.object({
  name: z.string().min(1).max(100),
  mappings: z.array(FieldMappingSchema),
});

type FieldMapping = z.infer<typeof FieldMappingSchema>;

function buildMappingMap(mappings: FieldMapping[]): Map<string, FieldMapping> {
  return new Map(mappings.filter(m => m.suggestedField).map(m => [m.sourceColumn, m]));
}

function applyMappings(raw: Record<string, string>, mappingMap: Map<string, FieldMapping>, extractor: ReturnType<typeof getDefaultExtractor>): Record<string, string> {
  const mapped: Record<string, string> = {};
  for (const [col, val] of Object.entries(raw)) {
    const mapping = mappingMap.get(col);
    if (!mapping || !mapping.suggestedField) continue;
    const field = mapping.suggestedField;
    if (mapping.isCombined) {
      const extracted = extractor.extractFromCombined(val, col);
      for (const [f, v] of Object.entries(extracted)) {
        if (!mapped[f]) mapped[f] = v;
      }
      if (!mapped[field]) mapped[field] = extractor.cleanValue(val, field);
    } else {
      mapped[field] = extractor.cleanValue(val, field);
    }
  }
  return mapped;
}

// ── POST /imports/analyze ─────────────────────────────────────────────────────
router.post("/imports/analyze", requirePermission("leads.import"), async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }

  const parsed = AnalyzeImportBodySchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid input", details: parsed.error.issues }); return; }

  const { headers, sampleRows, fileHash } = parsed.data;
  const wid = req.user.workspaceId ?? null;
  const extractor = getDefaultExtractor();

  try {
    const analyses = await extractor.analyzeColumns(headers, sampleRows);

    const mappings = analyses.map(a => ({
      sourceColumn: a.sourceColumn,
      suggestedField: a.suggestedField,
      confidence: a.confidence,
      isCombined: a.isCombined,
      combinedFields: a.combinedFields,
      detectionMethod: a.detectionMethod,
      sampleValues: a.sampleValues,
    }));

    const unmapped = mappings.filter(m => !m.suggestedField);
    const lowConfidence = mappings.filter(m => m.suggestedField && m.confidence < 60);
    const warnings: string[] = [];

    const hasCo = mappings.some(m => m.suggestedField === "companyName");
    const hasContact = mappings.some(m => m.suggestedField === "contactPerson");
    if (!hasCo) warnings.push("No column mapped to 'Company Name' — required for each lead.");
    if (!hasContact) warnings.push("No column mapped to 'Contact Person' — required for each lead.");

    const combined = mappings.filter(m => m.isCombined);
    for (const m of combined) {
      warnings.push(`Column "${m.sourceColumn}" appears to contain combined values (${m.combinedFields.join(" + ")}). Values will be auto-split during import.`);
    }

    // ── Duplicate file detection ──
    let duplicateFileWarning: string | null = null;
    if (fileHash) {
      const prevJob = await db.select({ id: importJobsTable.id, fileName: importJobsTable.fileName, createdAt: importJobsTable.createdAt })
        .from(importJobsTable)
        .where(and(eq(importJobsTable.fileHash, fileHash), wsFilter(importJobsTable.workspaceId, wid)))
        .orderBy(desc(importJobsTable.createdAt))
        .limit(1);
      if (prevJob.length > 0) {
        const p = prevJob[0];
        const dateStr = p.createdAt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
        duplicateFileWarning = `This file was already imported on ${dateStr} (job #${p.id}${p.fileName ? ` — "${p.fileName}"` : ""}). Proceeding may create duplicate leads.`;
      }
    }

    res.json({
      mappings,
      warnings,
      unknownColumns: unmapped.map(m => m.sourceColumn),
      entityExtractionHints: combined.map(m =>
        `"${m.sourceColumn}" contains ${m.combinedFields.join(" + ")} — will be extracted automatically`
      ),
      duplicateFileWarning,
      lowConfidenceColumns: lowConfidence.map(m => m.sourceColumn),
    });
  } catch (err) {
    req.log.error(err, "Failed to analyze import");
    res.status(500).json({ error: "Analysis failed" });
  }
});

// ── POST /imports/validate ────────────────────────────────────────────────────
router.post("/imports/validate", requirePermission("leads.import"), async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }

  const parsed = ValidateImportBodySchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid input" }); return; }

  const { rows, mappings } = parsed.data;
  const wid = req.user.workspaceId ?? null;
  const extractor = getDefaultExtractor();
  const mappingMap = buildMappingMap(mappings);

  const transformedRows = rows.map((raw, idx) => ({
    rowNum: idx + 1,
    data: applyMappings(raw, mappingMap, extractor),
  }));

  const incomingEmails = transformedRows
    .map(r => r.data.email?.toLowerCase().trim())
    .filter(Boolean) as string[];

  const existingEmailRows = incomingEmails.length > 0
    ? await db.select({ email: leadsTable.email, id: leadsTable.id, companyName: leadsTable.companyName })
        .from(leadsTable)
        .where(and(inArray(leadsTable.email, incomingEmails), wsFilter(leadsTable.workspaceId, wid)))
    : [];

  const existingEmails = new Map(existingEmailRows.map(r => [r.email?.toLowerCase() ?? "", r]));

  const validationErrors: { rowNum: number; field: string; message: string }[] = [];
  const duplicates: { rowNum: number; field: string; value: string; existingId?: number; existingCompany?: string }[] = [];
  const batchEmails = new Map<string, number>();

  for (const { rowNum, data } of transformedRows) {
    if (!data.companyName) {
      validationErrors.push({ rowNum, field: "companyName", message: "Missing company name" });
    }
    if (data.email) {
      const emailLower = data.email.toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
        validationErrors.push({ rowNum, field: "email", message: `Invalid email: ${data.email}` });
      } else {
        const existing = existingEmails.get(emailLower);
        if (existing) {
          duplicates.push({ rowNum, field: "email", value: data.email, existingId: existing.id, existingCompany: existing.companyName ?? undefined });
        } else if (batchEmails.has(emailLower)) {
          duplicates.push({ rowNum, field: "email", value: data.email, existingId: batchEmails.get(emailLower) });
        } else {
          batchEmails.set(emailLower, rowNum);
        }
      }
    }
  }

  res.json({
    totalRows: rows.length,
    uniqueRows: rows.length - duplicates.length,
    duplicateRows: duplicates.length,
    invalidRows: validationErrors.length,
    duplicates,
    validationErrors,
  });
});

// ── GET /imports/mapping-templates ───────────────────────────────────────────
// NOTE: this route must be declared BEFORE /imports/:id to avoid `:id` eating "mapping-templates"
router.get("/imports/mapping-templates", requirePermission("leads.import"), async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const wid = req.user.workspaceId ?? null;
  const templates = await db.select().from(importMappingTemplatesTable)
    .where(wsFilter(importMappingTemplatesTable.workspaceId, wid))
    .orderBy(desc(importMappingTemplatesTable.createdAt));
  res.json({ templates });
});

// ── POST /imports/mapping-templates ──────────────────────────────────────────
router.post("/imports/mapping-templates", requirePermission("leads.import"), async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }

  const parsed = CreateMappingTemplateSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid input" }); return; }

  const wid = req.user.workspaceId ?? null;
  const [template] = await db.insert(importMappingTemplatesTable).values({
    workspaceId: wid,
    createdById: req.user.id,
    name: parsed.data.name,
    mappings: parsed.data.mappings,
  }).returning();

  res.status(201).json(template);
});

// ── DELETE /imports/mapping-templates/:id ────────────────────────────────────
router.delete("/imports/mapping-templates/:id", requirePermission("leads.import"), async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const id = parseInt(String(req.params.id));
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const wid = req.user.workspaceId ?? null;
  await db.delete(importMappingTemplatesTable)
    .where(and(eq(importMappingTemplatesTable.id, id), wsFilter(importMappingTemplatesTable.workspaceId, wid)));
  res.status(204).send();
});

// ── POST /imports/execute (SSE streaming) ────────────────────────────────────
router.post("/imports/execute", requirePermission("leads.import"), async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }

  const parsed = ExecuteImportBodySchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid input" }); return; }

  const { rows, mappings, duplicateAction, fileName, fileHash } = parsed.data;
  const wid = req.user.workspaceId ?? null;
  const extractor = getDefaultExtractor();
  const mappingMap = buildMappingMap(mappings);

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  const send = (data: object) => { res.write(`data: ${JSON.stringify(data)}\n\n`); };

  const [job] = await db.insert(importJobsTable).values({
    workspaceId: wid,
    userId: req.user.id,
    status: "importing",
    fileName: fileName ?? "import",
    fileHash: fileHash ?? null,
    totalRows: rows.length,
    mappings: mappings,
  }).returning();

  send({ type: "start", jobId: job.id, total: rows.length });

  // Same type="lead" scoping fix as POST /leads in leads.ts — unfiltered,
  // this could tie-break onto a deal stage since stage "order" restarts at 1
  // for both lead and deal stages.
  const [firstStage] = await db.select().from(stagesTable)
    .where(and(wsFilter(stagesTable.workspaceId, wid), eq(stagesTable.type, "lead")))
    .orderBy(stagesTable.order);

  const incomingEmails = rows.flatMap(r => {
    for (const [col, val] of Object.entries(r)) {
      const mapping = mappingMap.get(col);
      if (mapping?.suggestedField === "email") return [val?.trim().toLowerCase()];
    }
    return [];
  }).filter(Boolean) as string[];

  const existingEmailRows = incomingEmails.length > 0
    ? await db.select({ email: leadsTable.email, id: leadsTable.id })
        .from(leadsTable)
        .where(and(inArray(leadsTable.email, incomingEmails), wsFilter(leadsTable.workspaceId, wid)))
    : [];

  const existingEmails = new Set(existingEmailRows.map(r => r.email?.toLowerCase()));
  const importedEmails = new Set<string>();
  let imported = 0, skipped = 0, updated = 0, failed = 0;
  const errorLog: { rowNum: number; message: string }[] = [];
  const BATCH = 100;

  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);

    for (let j = 0; j < batch.length; j++) {
      const rowNum = i + j + 1;
      try {
        const mapped = applyMappings(batch[j], mappingMap, extractor);

        if (!mapped.companyName) {
          errorLog.push({ rowNum, message: "Missing company name — skipped" });
          failed++;
          continue;
        }

        if (mapped.email) {
          const emailLower = mapped.email.toLowerCase();
          const isExisting = existingEmails.has(emailLower);
          const isBatchDupe = importedEmails.has(emailLower);

          if ((isExisting || isBatchDupe) && duplicateAction === "skip") {
            skipped++; continue;
          }
          if (isExisting && duplicateAction === "update") {
            const existingRow = existingEmailRows.find(r => r.email?.toLowerCase() === emailLower);
            if (existingRow) {
              await db.update(leadsTable).set({
                companyName: mapped.companyName,
                contactPerson: mapped.contactPerson || "Unknown",
                phone: mapped.phone || null,
                location: mapped.location || null,
                designation: mapped.designation || null,
                industry: mapped.industry || null,
                remarks: mapped.remarks || null,
                comment: mapped.comment || null,
                updatedAt: new Date(),
              }).where(eq(leadsTable.id, existingRow.id));
              updated++; continue;
            }
          }
          importedEmails.add(emailLower);
        }

        const priorityVal = (["hot", "warm", "cold"] as const).find(v => v === mapped.priority) ?? null;
        const channelVal = (["website", "whatsapp", "instagram", "email", "apollo", "referral", "linkedin", "database", "other"] as const).find(v => v === mapped.channel) ?? null;
        let closeDate: Date | null = null;
        if (mapped.expectedCloseDate) {
          const d = new Date(mapped.expectedCloseDate);
          if (!isNaN(d.getTime())) closeDate = d;
        }

        await db.insert(leadsTable).values({
          companyName: mapped.companyName,
          contactPerson: mapped.contactPerson || "Unknown",
          email: mapped.email || null,
          phone: mapped.phone || null,
          location: mapped.location || null,
          designation: mapped.designation || null,
          industry: mapped.industry || null,
          linkedinUrl: mapped.linkedinUrl || null,
          websiteUrl: mapped.websiteUrl || null,
          remarks: mapped.remarks || null,
          comment: mapped.comment || null,
          source: "csv_import",
          priority: priorityVal,
          channel: channelVal,
          valueAmount: mapped.valueAmount && !isNaN(Number(mapped.valueAmount)) ? mapped.valueAmount : null,
          expectedCloseDate: closeDate,
          stageId: firstStage?.id ?? null,
          ownerId: req.user.role === "bd" ? req.user.id : null,
          createdById: req.user.id,
          workspaceId: wid,
          importJobId: job.id,
        });
        imported++;
      } catch (err) {
        req.log.error({ err, rowNum }, "Import row failed");
        errorLog.push({ rowNum, message: "Database error — skipped" });
        failed++;
      }
    }

    send({ type: "progress", done: Math.min(i + BATCH, rows.length), total: rows.length, imported, skipped, updated, failed });
    await new Promise(r => setTimeout(r, 0));
  }

  const completedAt = new Date();
  await db.update(importJobsTable).set({
    status: "complete", importedRows: imported, skippedRows: skipped,
    updatedRows: updated, failedRows: failed, errors: errorLog, completedAt,
  }).where(eq(importJobsTable.id, job.id));

  // ── Audit trail ──
  await db.insert(auditLogsTable).values({
    userId: req.user.id,
    action: "bulk_import",
    tableName: "leads",
    newValue: JSON.stringify({ jobId: job.id, fileName: fileName ?? "import", totalRows: rows.length, importedRows: imported, skippedRows: skipped, failedRows: failed }),
    workspaceId: wid,
  }).catch(() => {});

  send({
    type: "complete",
    result: {
      id: job.id, totalRows: rows.length, importedRows: imported,
      skippedRows: skipped, updatedRows: updated, failedRows: failed,
      errors: errorLog, completedAt: completedAt.toISOString(),
      durationMs: completedAt.getTime() - job.createdAt.getTime(),
    },
  });
  res.end();
});

// ── POST /imports/:id/rollback ────────────────────────────────────────────────
router.post("/imports/:id/rollback", requirePermission("leads.import"), async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const id = parseInt(String(req.params.id));
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const wid = req.user.workspaceId ?? null;

  const [job] = await db.select().from(importJobsTable)
    .where(and(eq(importJobsTable.id, id), wsFilter(importJobsTable.workspaceId, wid)));

  if (!job) { res.status(404).json({ error: "Job not found" }); return; }
  if (job.status !== "complete") { res.status(409).json({ error: "Only completed imports can be rolled back" }); return; }
  if (job.rollbackedAt) { res.status(409).json({ error: "Import has already been rolled back" }); return; }

  const deleted = await db.delete(leadsTable)
    .where(and(eq(leadsTable.importJobId, id), wsFilter(leadsTable.workspaceId, wid)))
    .returning({ id: leadsTable.id });

  await db.update(importJobsTable).set({
    status: "rolled_back",
    rollbackedAt: new Date(),
  }).where(eq(importJobsTable.id, id));

  // Audit trail
  await db.insert(auditLogsTable).values({
    userId: req.user.id,
    action: "import_rollback",
    tableName: "leads",
    newValue: JSON.stringify({ jobId: id, deletedLeads: deleted.length }),
    workspaceId: wid,
  }).catch(() => {});

  res.json({ deletedLeads: deleted.length });
});

// ── GET /imports/:id/error-report ─────────────────────────────────────────────
router.get("/imports/:id/error-report", requirePermission("leads.import"), async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const id = parseInt(String(req.params.id));
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const wid = req.user.workspaceId ?? null;

  const [job] = await db.select({ errors: importJobsTable.errors, fileName: importJobsTable.fileName })
    .from(importJobsTable)
    .where(and(eq(importJobsTable.id, id), wsFilter(importJobsTable.workspaceId, wid)));

  if (!job) { res.status(404).json({ error: "Job not found" }); return; }

  const errors = (job.errors ?? []) as { rowNum: number; message: string }[];
  const lines = ["Row,Error", ...errors.map(e => `${e.rowNum},"${String(e.message).replace(/"/g, '""')}"`)];
  const baseName = (job.fileName ?? "import").replace(/\.[^.]+$/, "");

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="${baseName}-errors.csv"`);
  res.send(lines.join("\n"));
});

// ── GET /imports ──────────────────────────────────────────────────────────────
router.get("/imports", requirePermission("leads.import"), async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const wid = req.user.workspaceId ?? null;
  const jobs = await db.select().from(importJobsTable)
    .where(wsFilter(importJobsTable.workspaceId, wid))
    .orderBy(desc(importJobsTable.createdAt))
    .limit(20);

  const enriched = jobs.map(j => ({
    ...j,
    createdAt: j.createdAt.toISOString(),
    completedAt: j.completedAt?.toISOString() ?? null,
    rollbackedAt: j.rollbackedAt?.toISOString() ?? null,
    canRollback: j.status === "complete" && !j.rollbackedAt,
  }));

  res.json({ jobs: enriched });
});

export default router;
