import { randomUUID } from "node:crypto";
import { getDb } from "./sqlite";
import { leadActivityRepository } from "./leadActivityRepository";
import type { Lead, NewLead, LeadStatus } from "../types/lead";

// SQLite-backed (see ./sqlite.ts for the schema). The JSON-backed
// implementation this replaced is preserved verbatim at
// ./legacy/jsonLeadsRepository.ts as a rollback reference — see that file's
// header comment. Every existing caller (routes, services, tests) keeps
// using the exact same `leadsRepository` import and interface shape;
// `listPage`/`statusCounts` below are additive, for the new paginated leads
// list endpoint.

export interface LeadFilter {
  status?: LeadStatus;
  icpProfileId?: string;
  search?: string; // matches name/company/email
}

export interface LeadPageFilter extends LeadFilter {
  limit: number;
  offset: number;
}

export interface LeadPage {
  leads: Lead[];
  total: number;
}

export interface StatusCounts {
  all: number;
  new: number;
  qualified: number;
  rejected: number;
}

export interface BulkCreateResult {
  inserted: Lead[];
  skippedDuplicates: number;
}

export interface LeadsRepository {
  list(filter?: LeadFilter): Promise<Lead[]>;
  listPage(filter: LeadPageFilter): Promise<LeadPage>;
  statusCounts(): Promise<StatusCounts>;
  getById(id: string): Promise<Lead | null>;
  getByIds(ids: string[]): Promise<Lead[]>;
  bulkCreate(newLeads: NewLead[]): Promise<BulkCreateResult>;
  update(id: string, data: Partial<Lead>): Promise<Lead | null>;
  bulkUpdateStatus(ids: string[], status: LeadStatus): Promise<number>;
  delete(id: string): Promise<boolean>;
}

interface LeadRow {
  id: string;
  source: string;
  source_id: string;
  dedup_key: string;
  email: string | null;
  full_name: string;
  title: string | null;
  company: string | null;
  company_domain: string | null;
  linkedin_url: string | null;
  phone: string | null;
  location: string | null;
  status: string;
  icp_profile_id: string | null;
  search_run_id: string | null;
  raw: string | null;
  engagement_status: string;
  automation_enabled: number;
  role_category: string | null;
  industry: string | null;
  source_file: string | null;
  source_worksheet: string | null;
  crm_lead_id: number | null;
  crm_pushed_at: string | null;
  created_at: string;
  updated_at: string;
}

function rowToLead(row: LeadRow): Lead {
  return {
    id: row.id,
    source: row.source,
    sourceId: row.source_id,
    dedupKey: row.dedup_key,
    email: row.email,
    fullName: row.full_name,
    title: row.title,
    company: row.company,
    companyDomain: row.company_domain,
    linkedinUrl: row.linkedin_url,
    phone: row.phone,
    location: row.location,
    status: row.status as LeadStatus,
    icpProfileId: row.icp_profile_id,
    searchRunId: row.search_run_id,
    raw: row.raw != null ? JSON.parse(row.raw) : null,
    engagementStatus: row.engagement_status as Lead["engagementStatus"],
    automationEnabled: row.automation_enabled === 1,
    roleCategory: row.role_category,
    industry: row.industry,
    sourceFile: row.source_file,
    sourceWorksheet: row.source_worksheet,
    crmLeadId: row.crm_lead_id,
    crmPushedAt: row.crm_pushed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Builds the WHERE clause (and its bound params, in order) shared by list(),
// listPage(), and listPage()'s COUNT query — so the filtered set a caller
// counts is always exactly the same rows they can then page through.
function buildWhere(filter: LeadFilter): { sql: string; params: (string | number)[] } {
  const clauses: string[] = [];
  const params: (string | number)[] = [];
  if (filter.status) {
    clauses.push("status = ?");
    params.push(filter.status);
  }
  if (filter.icpProfileId) {
    clauses.push("icp_profile_id = ?");
    params.push(filter.icpProfileId);
  }
  if (filter.search) {
    const q = `%${filter.search.toLowerCase()}%`;
    clauses.push("(LOWER(full_name) LIKE ? OR LOWER(COALESCE(company, '')) LIKE ? OR LOWER(COALESCE(email, '')) LIKE ?)");
    params.push(q, q, q);
  }
  return { sql: clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "", params };
}

class SqliteLeadsRepository implements LeadsRepository {
  async list(filter: LeadFilter = {}): Promise<Lead[]> {
    const db = getDb();
    const { sql, params } = buildWhere(filter);
    const rows = db.prepare(`SELECT * FROM leads ${sql} ORDER BY created_at DESC`).all(...params) as unknown as LeadRow[];
    return rows.map(rowToLead);
  }

  async listPage(filter: LeadPageFilter): Promise<LeadPage> {
    const db = getDb();
    const { sql, params } = buildWhere(filter);
    const totalRow = db.prepare(`SELECT COUNT(*) as count FROM leads ${sql}`).get(...params) as unknown as { count: number };
    const rows = db
      .prepare(`SELECT * FROM leads ${sql} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
      .all(...params, filter.limit, filter.offset) as unknown as LeadRow[];
    return { leads: rows.map(rowToLead), total: totalRow.count };
  }

  async statusCounts(): Promise<StatusCounts> {
    const db = getDb();
    const rows = db.prepare("SELECT status, COUNT(*) as count FROM leads GROUP BY status").all() as unknown as { status: string; count: number }[];
    const counts: StatusCounts = { all: 0, new: 0, qualified: 0, rejected: 0 };
    for (const row of rows) {
      counts.all += row.count;
      if (row.status === "new" || row.status === "qualified" || row.status === "rejected") {
        counts[row.status] = row.count;
      }
    }
    return counts;
  }

  async getById(id: string): Promise<Lead | null> {
    const db = getDb();
    const row = db.prepare("SELECT * FROM leads WHERE id = ?").get(id) as unknown as LeadRow | undefined;
    return row ? rowToLead(row) : null;
  }

  async getByIds(ids: string[]): Promise<Lead[]> {
    if (ids.length === 0) return [];
    const db = getDb();
    const placeholders = ids.map(() => "?").join(",");
    const rows = db.prepare(`SELECT * FROM leads WHERE id IN (${placeholders})`).all(...ids) as unknown as LeadRow[];
    return rows.map(rowToLead);
  }

  // dedup is enforced by SQLite itself (dedup_key UNIQUE index) via
  // INSERT ... ON CONFLICT DO NOTHING, rather than loading every existing
  // dedup key into a JS Set first — this is what lets a 654K-row import's
  // dedup check stay O(1)-indexed per row instead of holding the whole
  // existing key set in memory. The same statement, run against the SAME
  // table inside one transaction, also naturally rejects a second row
  // within THIS batch that shares a dedup_key with an earlier one in the
  // batch — one mechanism handles both "duplicate of an existing lead" and
  // "duplicate within this file" identically.
  async bulkCreate(newLeads: NewLead[]): Promise<BulkCreateResult> {
    const db = getDb();
    const now = new Date().toISOString();
    const insert = db.prepare(`
      INSERT INTO leads (
        id, source, source_id, dedup_key, email, full_name, title, company, company_domain,
        linkedin_url, phone, location, status, icp_profile_id, search_run_id, raw,
        engagement_status, automation_enabled, role_category, industry, source_file, source_worksheet,
        crm_lead_id, crm_pushed_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(dedup_key) DO NOTHING
    `);

    const inserted: Lead[] = [];
    let skippedDuplicates = 0;

    db.exec("BEGIN");
    try {
      for (const nl of newLeads) {
        const lead: Lead = {
          id: randomUUID(),
          status: nl.status ?? "new",
          source: nl.source,
          sourceId: nl.sourceId,
          dedupKey: nl.dedupKey,
          email: nl.email,
          fullName: nl.fullName,
          title: nl.title,
          company: nl.company,
          companyDomain: nl.companyDomain,
          linkedinUrl: nl.linkedinUrl,
          phone: nl.phone,
          location: nl.location,
          icpProfileId: nl.icpProfileId,
          searchRunId: nl.searchRunId,
          raw: nl.raw,
          engagementStatus: nl.engagementStatus ?? "active",
          automationEnabled: nl.automationEnabled ?? true,
          roleCategory: nl.roleCategory ?? null,
          industry: nl.industry ?? null,
          sourceFile: nl.sourceFile ?? null,
          sourceWorksheet: nl.sourceWorksheet ?? null,
          crmLeadId: null,
          crmPushedAt: null,
          createdAt: now,
          updatedAt: now,
        };
        const result = insert.run(
          lead.id,
          lead.source,
          lead.sourceId,
          lead.dedupKey,
          lead.email,
          lead.fullName,
          lead.title,
          lead.company,
          lead.companyDomain,
          lead.linkedinUrl,
          lead.phone,
          lead.location,
          lead.status,
          lead.icpProfileId,
          lead.searchRunId,
          lead.raw != null ? JSON.stringify(lead.raw) : null,
          lead.engagementStatus,
          lead.automationEnabled ? 1 : 0,
          lead.roleCategory,
          lead.industry,
          lead.sourceFile,
          lead.sourceWorksheet,
          lead.crmLeadId,
          lead.crmPushedAt,
          lead.createdAt,
          lead.updatedAt
        );
        if (Number(result.changes) === 1) {
          inserted.push(lead);
        } else {
          skippedDuplicates += 1;
        }
      }
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }

    if (inserted.length > 0) {
      await leadActivityRepository.recordMany(
        inserted.map((lead) => ({
          leadId: lead.id,
          type: "lead_created" as const,
          summary: lead.source === "manual" ? "Lead added manually" : `Lead found via ${lead.source}`,
        }))
      );
    }

    return { inserted, skippedDuplicates };
  }

  async update(id: string, data: Partial<Lead>): Promise<Lead | null> {
    const db = getDb();
    const existing = db.prepare("SELECT * FROM leads WHERE id = ?").get(id) as unknown as LeadRow | undefined;
    if (!existing) return null;

    const current = rowToLead(existing);
    const updated: Lead = { ...current, ...data, id: current.id, updatedAt: new Date().toISOString() };

    db.prepare(`
      UPDATE leads SET
        source = ?, source_id = ?, dedup_key = ?, email = ?, full_name = ?, title = ?, company = ?,
        company_domain = ?, linkedin_url = ?, phone = ?, location = ?, status = ?, icp_profile_id = ?,
        search_run_id = ?, raw = ?, engagement_status = ?, automation_enabled = ?, role_category = ?,
        industry = ?, source_file = ?, source_worksheet = ?, crm_lead_id = ?, crm_pushed_at = ?, updated_at = ?
      WHERE id = ?
    `).run(
      updated.source,
      updated.sourceId,
      updated.dedupKey,
      updated.email,
      updated.fullName,
      updated.title,
      updated.company,
      updated.companyDomain,
      updated.linkedinUrl,
      updated.phone,
      updated.location,
      updated.status,
      updated.icpProfileId,
      updated.searchRunId,
      updated.raw != null ? JSON.stringify(updated.raw) : null,
      updated.engagementStatus,
      updated.automationEnabled ? 1 : 0,
      updated.roleCategory,
      updated.industry,
      updated.sourceFile,
      updated.sourceWorksheet,
      updated.crmLeadId,
      updated.crmPushedAt,
      updated.updatedAt,
      updated.id
    );

    return updated;
  }

  async bulkUpdateStatus(ids: string[], status: LeadStatus): Promise<number> {
    if (ids.length === 0) return 0;
    const db = getDb();
    const now = new Date().toISOString();
    const placeholders = ids.map(() => "?").join(",");
    const result = db.prepare(`UPDATE leads SET status = ?, updated_at = ? WHERE id IN (${placeholders})`).run(status, now, ...ids);
    return Number(result.changes);
  }

  async delete(id: string): Promise<boolean> {
    const db = getDb();
    const result = db.prepare("DELETE FROM leads WHERE id = ?").run(id);
    return Number(result.changes) > 0;
  }
}

export const leadsRepository: LeadsRepository = new SqliteLeadsRepository();
