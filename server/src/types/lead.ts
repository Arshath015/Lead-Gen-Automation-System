export type LeadStatus = "new" | "qualified" | "rejected";

// Orthogonal to LeadStatus (which tracks qualification): this tracks whether
// the lead is still a safe target for automated outreach. Any value other
// than "active" halts automation for that lead, independent of its
// qualification status or the per-lead automationEnabled flag.
export type EngagementStatus = "active" | "replied" | "bounced" | "unsubscribed" | "not_interested";

export interface Lead {
  id: string;
  source: string; // "apollo" | "manual" | future sources
  sourceId: string; // id from the external source
  dedupKey: string; // used to prevent duplicate leads across searches/sources
  email: string | null;
  fullName: string;
  title: string | null;
  company: string | null;
  companyDomain: string | null;
  linkedinUrl: string | null;
  phone: string | null;
  location: string | null;
  status: LeadStatus;
  icpProfileId: string | null;
  searchRunId: string | null;
  raw: unknown; // original payload from the source, kept for reference
  engagementStatus: EngagementStatus;
  automationEnabled: boolean; // per-lead opt-out of automation even while globally enabled
  // Provenance for file-imported leads (source: "import"). Null for
  // Apollo/manual leads and for any lead created before this field existed.
  roleCategory: string | null; // e.g. "Chairman", "Director", "CMO / Marketing Head" from the import file's Role Category column
  industry: string | null; // from the import file's Industry column
  sourceFile: string | null; // the import file's own "Source File" column value, e.g. "Company Director 108057.xlsx" — distinct from the uploaded workbook's filename
  sourceWorksheet: string | null; // the worksheet name the row was imported from, e.g. "Directors"
  crmLeadId: number | null; // the CRM's own numeric lead id, once pushed there — see crm/crmClient.ts
  crmPushedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type NewLead = Omit<
  Lead,
  "id" | "createdAt" | "updatedAt" | "status" | "engagementStatus" | "automationEnabled" | "crmLeadId" | "crmPushedAt"
> & {
  status?: LeadStatus;
  engagementStatus?: EngagementStatus;
  automationEnabled?: boolean;
};
