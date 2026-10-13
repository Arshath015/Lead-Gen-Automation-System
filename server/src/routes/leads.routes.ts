import { randomUUID } from "node:crypto";
import { Router } from "express";
import { leadsRepository } from "../db/leadsRepository";
import { followUpTasksRepository } from "../db/followUpTasksRepository";
import { leadActivityRepository } from "../db/leadActivityRepository";
import { engagementEventsRepository } from "../db/engagementEventsRepository";
import { getSourceAdapter } from "../sources/registry";
import { SourceApiError } from "../sources/SourceApiError";
import { computeDedupKey } from "../normalize/leads";
import { pushLeadToCrm, CrmNotConfiguredError, CrmRequestError } from "../crm/crmClient";
import type { Lead, LeadStatus, NewLead } from "../types/lead";

export const leadsRouter = Router();

// Business fields a client is allowed to change via PATCH. Everything else —
// id, source, sourceId, dedupKey, raw, searchRunId, createdAt, updatedAt — is
// internal bookkeeping and must never be settable from an API request body.
export const PATCHABLE_LEAD_FIELDS = [
  "fullName",
  "title",
  "company",
  "companyDomain",
  "email",
  "linkedinUrl",
  "phone",
  "location",
  "status",
  "icpProfileId",
  "engagementStatus",
  "automationEnabled",
  "roleCategory",
  "industry",
] as const satisfies readonly (keyof Lead)[];

export function pickPatchableLeadFields(body: unknown): Partial<Lead> {
  const source = (body ?? {}) as Record<string, unknown>;
  const picked: Partial<Lead> = {};
  for (const field of PATCHABLE_LEAD_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(source, field)) {
      (picked as Record<string, unknown>)[field] = source[field];
    }
  }
  return picked;
}

// Bounds match what makes sense for a table UI, not the storage layer —
// SQLite has no trouble returning more, but a browser tab rendering
// thousands of table rows at once is exactly the problem pagination exists
// to avoid. DEFAULT_PAGE_SIZE (100) safely covers the current real dataset
// (245 leads) in a couple of pages without the UI needing to change its
// default view; MAX_PAGE_SIZE (1000) is a hard ceiling regardless of what a
// caller requests.
const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 1000;

function parsePageParam(value: unknown, fallback: number, max?: number): number {
  const n = typeof value === "string" ? Number.parseInt(value, 10) : NaN;
  if (!Number.isFinite(n) || n < 0) return fallback;
  return max != null ? Math.min(n, max) : n;
}

leadsRouter.get("/", async (req, res) => {
  const { status, icpProfileId, search, limit, offset } = req.query;
  const filter = {
    status: status as LeadStatus | undefined,
    icpProfileId: icpProfileId as string | undefined,
    search: search as string | undefined,
  };
  const [page, statusCounts] = await Promise.all([
    leadsRepository.listPage({
      ...filter,
      limit: parsePageParam(limit, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE),
      offset: parsePageParam(offset, 0),
    }),
    leadsRepository.statusCounts(),
  ]);
  res.json({ leads: page.leads, total: page.total, limit: parsePageParam(limit, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE), offset: parsePageParam(offset, 0), statusCounts });
});

leadsRouter.get("/:id/activity", async (req, res) => {
  const events = await leadActivityRepository.listByLeadId(req.params.id);
  res.json(events);
});

// Manually adds a single lead, distinct from Apollo-sourced ones. It flows
// through the same status/research/draft/send pipeline as any other lead —
// only `source` differs, so downstream code never needs to special-case it.
leadsRouter.post("/", async (req, res) => {
  const { fullName, title, company, email, location, linkedinUrl } = req.body ?? {};
  if (!fullName || typeof fullName !== "string" || !fullName.trim()) {
    return res.status(400).json({ error: "fullName is required" });
  }

  const sourceId = randomUUID();
  const normalizedEmail: string | null = email && typeof email === "string" && email.trim() ? email.trim() : null;
  const newLead: NewLead = {
    source: "manual",
    sourceId,
    dedupKey: computeDedupKey({
      source: "manual",
      sourceId,
      email: normalizedEmail,
      companyDomain: null,
      fullName: fullName.trim(),
    }),
    email: normalizedEmail,
    fullName: fullName.trim(),
    title: title?.trim() || null,
    company: company?.trim() || null,
    companyDomain: null,
    linkedinUrl: linkedinUrl?.trim() || null,
    phone: null,
    location: location?.trim() || null,
    icpProfileId: null,
    searchRunId: null,
    raw: null,
    roleCategory: null,
    industry: null,
    sourceFile: null,
    sourceWorksheet: null,
  };

  const { inserted, skippedDuplicates } = await leadsRepository.bulkCreate([newLead]);
  if (skippedDuplicates > 0) {
    return res.status(409).json({ error: "A lead with this email already exists" });
  }
  res.status(201).json(inserted[0]);
});

const STATUS_LABELS: Record<string, string> = { new: "New", qualified: "Qualified", rejected: "Rejected" };
const ENGAGEMENT_LABELS: Record<string, string> = {
  active: "Active",
  replied: "Replied",
  bounced: "Bounced",
  unsubscribed: "Unsubscribed",
  not_interested: "Not interested",
};

leadsRouter.patch("/:id", async (req, res) => {
  const before = await leadsRepository.getById(req.params.id);
  if (!before) return res.status(404).json({ error: "Not found" });

  const updated = await leadsRepository.update(req.params.id, pickPatchableLeadFields(req.body));
  if (!updated) return res.status(404).json({ error: "Not found" });

  if (updated.status !== before.status) {
    await leadActivityRepository.record(
      updated.id,
      "status_changed",
      `Status changed from ${STATUS_LABELS[before.status] ?? before.status} to ${STATUS_LABELS[updated.status] ?? updated.status}`
    );
  }
  if (updated.engagementStatus !== before.engagementStatus) {
    await leadActivityRepository.record(
      updated.id,
      "engagement_changed",
      `Engagement changed from ${ENGAGEMENT_LABELS[before.engagementStatus] ?? before.engagementStatus} to ${ENGAGEMENT_LABELS[updated.engagementStatus] ?? updated.engagementStatus}`
    );
  }
  if (updated.automationEnabled !== before.automationEnabled) {
    await leadActivityRepository.record(
      updated.id,
      "automation_toggled",
      updated.automationEnabled ? "Automation enabled for this lead" : "Automation disabled for this lead"
    );
  }

  // Any transition away from "active" (replied, bounced, unsubscribed, marked
  // not interested) must stop the sequence immediately — cancel whatever
  // follow-ups are still pending rather than letting them fire later.
  if (updated.engagementStatus !== "active") {
    await followUpTasksRepository.cancelAllForLead(updated.id);
  }
  res.json(updated);
});

leadsRouter.delete("/:id", async (req, res) => {
  await followUpTasksRepository.cancelAllForLead(req.params.id);
  const ok = await leadsRepository.delete(req.params.id);
  if (!ok) return res.status(404).json({ error: "Not found" });
  await leadActivityRepository.deleteAllForLead(req.params.id);
  await engagementEventsRepository.deleteAllForLead(req.params.id);
  res.status(204).send();
});

leadsRouter.post("/bulk-status", async (req, res) => {
  const { ids, status } = req.body ?? {};
  if (!Array.isArray(ids) || !status) {
    return res.status(400).json({ error: "ids[] and status are required" });
  }
  const count = await leadsRepository.bulkUpdateStatus(ids, status);
  res.json({ updated: count });
});

// Reveals email for a single lead. Spends an Apollo lead credit — unless the
// lead is already revealed, in which case we return it untouched rather than
// spending another credit re-fetching data we already have.
leadsRouter.post("/:id/reveal", async (req, res) => {
  const lead = await leadsRepository.getById(req.params.id);
  if (!lead) return res.status(404).json({ error: "Not found" });
  if (lead.email) return res.json(lead);

  const adapter = getSourceAdapter(lead.source);
  if (!adapter) return res.status(400).json({ error: `Unknown source: ${lead.source}` });

  try {
    const { email, fullName, linkedinUrl } = await adapter.revealContact(lead.sourceId);
    const updated = await leadsRepository.update(lead.id, {
      email,
      ...(fullName ? { fullName } : {}),
      ...(linkedinUrl ? { linkedinUrl } : {}),
    });
    await leadActivityRepository.record(lead.id, "email_revealed", `Email revealed: ${email}`);
    res.json(updated);
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

// Shared by both the single-lead and bulk "send to CRM" routes below —
// pushes one lead, persists the resulting crmLeadId/crmPushedAt, and logs
// the activity-feed entry. Callers decide how to handle a throw.
async function pushAndRecordCrm(lead: Lead): Promise<Lead> {
  const { crmLeadId } = await pushLeadToCrm(lead);
  const updated = await leadsRepository.update(lead.id, {
    crmLeadId,
    crmPushedAt: new Date().toISOString(),
  });
  await leadActivityRepository.record(lead.id, "sent_to_crm", `Sent to CRM (CRM lead #${crmLeadId})`);
  return updated as Lead;
}

// Manual, lead-by-lead handoff into the separate CRM (see
// CRM_INTEGRATION_OVERVIEW.pdf) — never automatic, always a deliberate click.
// Re-pushing an already-pushed lead is a no-op that just returns it as-is
// rather than creating a second CRM record for the same person.
leadsRouter.post("/:id/send-to-crm", async (req, res) => {
  const lead = await leadsRepository.getById(req.params.id);
  if (!lead) return res.status(404).json({ error: "Not found" });
  if (lead.crmLeadId) return res.json(lead);

  try {
    const updated = await pushAndRecordCrm(lead);
    res.json(updated);
  } catch (err) {
    if (err instanceof CrmNotConfiguredError) return res.status(503).json({ error: err.message });
    if (err instanceof CrmRequestError) return res.status(502).json({ error: err.message });
    res.status(502).json({ error: (err as Error).message });
  }
});

// Bulk variant, scoped specifically to Qualified leads — still a single
// deliberate click, not an automatic trigger on qualification. Leads already
// in the CRM are skipped (not re-pushed); one failure doesn't stop the rest
// of the batch from being attempted, mirroring reveal-bulk's behavior below.
leadsRouter.post("/send-qualified-to-crm", async (_req, res) => {
  const qualified = await leadsRepository.list({ status: "qualified" });
  const toPush = qualified.filter((l) => !l.crmLeadId);

  let pushed = 0;
  const failures: { id: string; fullName: string; error: string }[] = [];

  for (const lead of toPush) {
    try {
      await pushAndRecordCrm(lead);
      pushed += 1;
    } catch (err) {
      const message =
        err instanceof CrmNotConfiguredError || err instanceof CrmRequestError
          ? err.message
          : (err as Error).message;
      failures.push({ id: lead.id, fullName: lead.fullName, error: message });
      // CRM isn't configured at all — every remaining lead will fail
      // identically, so stop instead of recording the same error N times.
      if (err instanceof CrmNotConfiguredError) break;
    }
  }

  res.json({
    totalQualified: qualified.length,
    alreadyInCrm: qualified.length - toPush.length,
    pushed,
    failed: failures.length,
    failures,
  });
});

type RevealOutcome = "revealed" | "already_revealed" | "failed" | "skipped";

interface RevealResult {
  id: string;
  fullName: string;
  email: string | null;
  outcome: RevealOutcome;
  error?: string;
}

// Reveals email for multiple leads in sequence. Leads that already have an
// email are left alone (no credit spent, reported as already_revealed so the
// UI never has to guess whether "not in the failed list" means success).
// If Apollo reports credits are exhausted, every remaining lead is marked
// "skipped" instead of being retried one-by-one against a wall — that would
// waste requests and give a misleading "N failures" count for what is really
// one exhausted-credit event.
leadsRouter.post("/reveal-bulk", async (req, res) => {
  const { ids } = req.body ?? {};
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: "ids[] is required" });
  }
  const leads = await leadsRepository.getByIds(ids);
  const results: RevealResult[] = [];
  let stopReason: string | null = null;

  for (const lead of leads) {
    if (stopReason) {
      results.push({ id: lead.id, fullName: lead.fullName, email: null, outcome: "skipped", error: stopReason });
      continue;
    }
    if (lead.email) {
      results.push({ id: lead.id, fullName: lead.fullName, email: lead.email, outcome: "already_revealed" });
      continue;
    }

    const adapter = getSourceAdapter(lead.source);
    if (!adapter) {
      results.push({
        id: lead.id,
        fullName: lead.fullName,
        email: null,
        outcome: "failed",
        error: `Unknown source: ${lead.source}`,
      });
      continue;
    }
    try {
      const { email, fullName, linkedinUrl } = await adapter.revealContact(lead.sourceId);
      await leadsRepository.update(lead.id, {
        email,
        ...(fullName ? { fullName } : {}),
        ...(linkedinUrl ? { linkedinUrl } : {}),
      });
      await leadActivityRepository.record(lead.id, "email_revealed", `Email revealed: ${email}`);
      results.push({ id: lead.id, fullName: lead.fullName, email, outcome: "revealed" });
    } catch (err) {
      const message = (err as Error).message;
      results.push({ id: lead.id, fullName: lead.fullName, email: null, outcome: "failed", error: message });
      if (err instanceof SourceApiError && err.code === "BILLING.LIMIT.CREDITS_EXHAUSTED") {
        stopReason = message;
      }
    }
  }

  res.json({ results });
});

function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const escape = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => escape(row[h])).join(","));
  }
  return lines.join("\n");
}

leadsRouter.post("/export", async (req, res) => {
  const { ids } = req.body ?? {};
  const leads = Array.isArray(ids) && ids.length > 0
    ? await leadsRepository.getByIds(ids)
    : await leadsRepository.list();

  const csv = toCsv(
    leads.map((l) => ({
      fullName: l.fullName,
      email: l.email ?? "",
      title: l.title ?? "",
      company: l.company ?? "",
      companyDomain: l.companyDomain ?? "",
      linkedinUrl: l.linkedinUrl ?? "",
      phone: l.phone ?? "",
      location: l.location ?? "",
      status: l.status,
      source: l.source,
      roleCategory: l.roleCategory ?? "",
      industry: l.industry ?? "",
      sourceFile: l.sourceFile ?? "",
      sourceWorksheet: l.sourceWorksheet ?? "",
    }))
  );

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", "attachment; filename=leads.csv");
  res.send(csv);
});
