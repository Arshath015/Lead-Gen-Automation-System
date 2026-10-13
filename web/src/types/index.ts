// Public, secret-free status of one registered lead-source connector — never
// carries credentials, mirrors server/src/routes/connectors.routes.ts's DTO.
export interface ConnectorStatus {
  name: string;
  capabilities: string[];
  configured: boolean;
}

export interface IcpFilters {
  personTitles: string[];
  personLocations: string[];
  organizationLocations: string[];
  organizationDomains: string[];
  employeeRanges: string[];
  keywords: string;
}

export interface IcpProfile {
  id: string;
  name: string;
  filters: IcpFilters;
  createdAt: string;
  updatedAt: string;
}

export type LeadStatus = "new" | "qualified" | "rejected";

export type ResearchStatus = "pending" | "in_progress" | "complete" | "failed";

export interface ResearchNewsItem {
  title: string;
  url: string;
  publishedAt: string | null;
  summary: string;
}

export interface ResearchSource {
  title: string;
  url: string;
}

export interface ResearchBrief {
  id: string;
  leadId: string;
  status: ResearchStatus;
  companyOverview: string | null;
  recentNews: ResearchNewsItem[];
  painPoints: string[];
  sources: ResearchSource[];
  model: string | null;
  editedByUser: boolean;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export type SendStatus = "not_sent" | "sending" | "sent" | "failed";

export interface EmailDraft {
  id: string;
  leadId: string;
  researchBriefId: string | null;
  subject: string;
  body: string;
  model: string | null;
  editedByUser: boolean;
  generatedAt: string;
  updatedAt: string;
  sendStatus: SendStatus;
  sentAt: string | null;
  resendMessageId: string | null;
  sendError: string | null;
}

export type RevealOutcome = "revealed" | "already_revealed" | "failed" | "skipped";

export interface RevealResult {
  id: string;
  fullName: string;
  email: string | null;
  outcome: RevealOutcome;
  error?: string;
}

export type EngagementStatus = "active" | "replied" | "bounced" | "unsubscribed" | "not_interested";

export interface Lead {
  id: string;
  source: string;
  sourceId: string;
  dedupKey: string;
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
  engagementStatus: EngagementStatus;
  automationEnabled: boolean;
  roleCategory: string | null;
  industry: string | null;
  sourceFile: string | null;
  sourceWorksheet: string | null;
  crmLeadId: number | null;
  crmPushedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LeadStatusCounts {
  all: number;
  new: number;
  qualified: number;
  rejected: number;
}

export interface LeadsPageResponse {
  leads: Lead[];
  total: number;
  limit: number;
  offset: number;
  statusCounts: LeadStatusCounts;
}

export interface EmailAutomationSettings {
  paused: boolean;
  autoDraftEnabled: boolean;
  autoSendEnabled: boolean;
  autoFollowUpEnabled: boolean;
  dailySendLimit: number;
  delayBetweenEmailsMinutes: number;
  sendingDays: number[];
  sendingHourStart: number;
  sendingHourEnd: number;
  followUpCount: number;
  followUpDelayDays: number;
  emailSignature: string;
  updatedAt: string;
}

export type LeadActivityType =
  | "lead_created"
  | "status_changed"
  | "engagement_changed"
  | "automation_toggled"
  | "email_revealed"
  | "research_completed"
  | "research_failed"
  | "draft_generated"
  | "draft_edited"
  | "email_sent"
  | "email_send_failed"
  | "follow_up_sent"
  | "sent_to_crm"
  | "webhook_replied"
  | "webhook_bounced"
  | "webhook_complained"
  | "webhook_delivered"
  | "webhook_opened"
  | "webhook_clicked";

export interface LeadActivityEvent {
  id: string;
  leadId: string;
  type: LeadActivityType;
  summary: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export type FollowUpTaskStatus = "pending" | "sending" | "sent" | "cancelled" | "failed";

export interface FollowUpTask {
  id: string;
  leadId: string;
  sequenceNumber: number;
  scheduledFor: string;
  status: FollowUpTaskStatus;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FollowUpMessage {
  id: string;
  leadId: string;
  followUpTaskId: string;
  sequenceNumber: number;
  subject: string;
  body: string;
  model: string | null;
  sentAt: string;
  resendMessageId: string | null;
}

// Mirrors server/src/automation/followUpEligibility.ts — the reason the
// scheduler itself would give (right now) for why this lead's next
// automatic follow-up hasn't gone out, computed via the exact same gates
// the scheduler evaluates. Never computed independently in the UI, so the
// displayed reason can't drift from actual scheduler behavior.
export type FollowUpDueReason =
  | "paused"
  | "outside_sending_window"
  | "quota_reached"
  | "waiting_for_delay"
  | "followup_automation_disabled"
  | "lead_ineligible"
  | "ready";

export interface FollowUpDueStatus {
  reason: FollowUpDueReason;
  message: string;
}

// Automatic, webhook-derived engagement tracking — never user-editable.
// Distinct from Lead.engagementStatus (which a human can still override to
// stop automation regardless of what the real events say).
export type EngagementEventType = "delivered" | "opened" | "clicked" | "bounced" | "complained" | "received";

// Best-effort, provider-supplied approximation only — never the recipient's
// exact physical location. city/region are null when unresolved even if
// country is known. likelyProxied flags an IP that resolves to known
// email/image-proxy infrastructure (Gmail's own proxy, Apple Mail Privacy
// Protection / iCloud Private Relay, etc.) — in that case country/region/city
// are ALL null, since the location belongs to the proxy's infrastructure,
// not the recipient (and may have no geographic relationship to them at
// all).
export interface ApproxLocation {
  country: string | null;
  region: string | null;
  city: string | null;
  approximate: true;
  likelyProxied: boolean;
}

export interface EngagementEvent {
  id: string;
  webhookEventId: string;
  type: EngagementEventType;
  emailId: string | null;
  messageId: string | null;
  leadId: string | null;
  occurredAt: string;
  ip: string | null;
  userAgent: string | null;
  clickedLink: string | null;
  location: ApproxLocation | null;
  createdAt: string;
}

export interface EngagementSummary {
  sentCount: number;
  deliveredCount: number;
  openedCount: number;
  clickedCount: number;
  bouncedCount: number;
  complainedCount: number;
  repliedCount: number;
  deliveryRate: number;
  openRate: number;
  clickRate: number;
  replyRate: number;
  bounceRate: number;
  complaintRate: number;
}

// A normal file attachment uploaded once in Settings and optionally included
// on every newly sent email/follow-up going forward. Conceptually separate
// from the signature: never embedded inline in signature HTML.
export interface DefaultAttachment {
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  includeByDefault: boolean;
  createdAt: string;
}

export interface EmailPreviewAttachment {
  filename: string;
  contentType: string;
  sizeBytes: number;
  inline: boolean;
}

export interface EmailPreview {
  text: string;
  html: string;
  attachments: EmailPreviewAttachment[];
}

export interface SignatureImageUploadResult {
  id: string;
  url: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
}

// --- Import feature -----------------------------------------------------
// Mirrors server/src/import/schema.ts, import/parseWorkbook.ts,
// import/importPipeline.ts, and routes/import.routes.ts DTOs — the frontend
// never reimplements header-matching/dedup/normalization logic, only renders
// what these endpoints already computed.

export type CanonicalField =
  | "company"
  | "contactName"
  | "designation"
  | "roleCategory"
  | "email"
  | "phone"
  | "city"
  | "state"
  | "industry"
  | "sourceFile";

export interface UnmappedColumn {
  index: number;
  header: string;
}

export interface DuplicateHeader {
  header: string;
  indexes: number[];
}

export interface UploadedWorksheetDto {
  name: string;
  headerRowNumber: number | null;
  headers: string[];
  approxDataRowCount: number;
  suggestedMapping: Partial<Record<CanonicalField, number>>;
  missingFields: CanonicalField[];
  unmappedColumns: UnmappedColumn[];
  duplicateHeaders: DuplicateHeader[];
  importable: boolean;
}

export interface UploadedFileDto {
  fileId: string;
  originalFilename: string;
  worksheets: UploadedWorksheetDto[];
}

export interface ColumnMapping {
  fileId: string;
  originalFilename: string;
  sheetName: string;
  headerRowNumber: number;
  fieldColumns: Record<CanonicalField, number | null>;
}

export interface ImportRowError {
  fileId: string;
  originalFilename: string;
  sheetName: string;
  rowNumber: number;
  reason: string;
}

export interface ImportNormalizedRecord {
  company: string | null;
  fullName: string | null;
  title: string | null;
  roleCategory: string | null;
  email: string | null;
  emailValid: boolean;
  phone: string | null;
  location: string | null;
  city: string | null;
  state: string | null;
  industry: string | null;
  sourceFile: string | null;
}

export interface SheetPreviewStats {
  fileId: string;
  originalFilename: string;
  sheetName: string;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  duplicateExistingRows: number;
  duplicateInFileRows: number;
  rowsWithInvalidEmailFormat: number;
  blankFieldCounts: Partial<Record<CanonicalField, number>>;
  willImportRows: number;
}

export interface ImportPreviewSummary {
  sheets: SheetPreviewStats[];
  totals: {
    totalRows: number;
    validRows: number;
    invalidRows: number;
    duplicateExistingRows: number;
    duplicateInFileRows: number;
    rowsWithInvalidEmailFormat: number;
    willImportRows: number;
  };
  sampleRecords: ImportNormalizedRecord[];
  sampleErrors: ImportRowError[];
}

export interface ImportCommitResult {
  imported: number;
  skippedDuplicates: number;
  invalidRows: number;
  failedRows: number;
  aborted: boolean;
  abortReason: string | null;
  errorRowCount: number;
}
