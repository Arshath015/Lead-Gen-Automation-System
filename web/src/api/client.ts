import type {
  ColumnMapping,
  ConnectorStatus,
  DefaultAttachment,
  EmailAutomationSettings,
  EmailDraft,
  EmailPreview,
  EngagementEvent,
  EngagementSummary,
  FollowUpDueStatus,
  FollowUpMessage,
  FollowUpTask,
  IcpFilters,
  IcpProfile,
  ImportCommitResult,
  ImportPreviewSummary,
  Lead,
  LeadActivityEvent,
  LeadsPageResponse,
  LeadStatus,
  ResearchBrief,
  RevealResult,
  SignatureImageUploadResult,
  UploadedFileDto,
} from "../types";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  getConfig: () => request<{ emailFrom: string }>("/config"),
  listConnectors: () => request<ConnectorStatus[]>("/connectors"),

  listIcpProfiles: () => request<IcpProfile[]>("/icp-profiles"),
  createIcpProfile: (name: string, filters: IcpFilters) =>
    request<IcpProfile>("/icp-profiles", {
      method: "POST",
      body: JSON.stringify({ name, filters }),
    }),
  updateIcpProfile: (id: string, data: { name?: string; filters?: IcpFilters }) =>
    request<IcpProfile>(`/icp-profiles/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteIcpProfile: (id: string) => request<void>(`/icp-profiles/${id}`, { method: "DELETE" }),

  runSearch: (icpProfileId: string, page?: number, perPage = 25) =>
    request<{
      inserted: number;
      skippedDuplicates: number;
      fetched: number;
      totalAvailable: number;
      page: number;
      keywordDropped: boolean;
    }>(
      "/search",
      { method: "POST", body: JSON.stringify({ icpProfileId, page, perPage }) }
    ),

  listLeads: (params: { status?: string; icpProfileId?: string; search?: string; limit?: number; offset?: number } = {}) => {
    const qs = new URLSearchParams(
      Object.entries(params)
        .filter(([, v]) => v !== undefined && v !== "")
        .map(([k, v]) => [k, String(v)])
    ).toString();
    return request<LeadsPageResponse>(`/leads${qs ? `?${qs}` : ""}`);
  },
  createLead: (data: {
    fullName: string;
    title?: string;
    company?: string;
    email?: string;
    location?: string;
    linkedinUrl?: string;
  }) => request<Lead>("/leads", { method: "POST", body: JSON.stringify(data) }),
  updateLead: (id: string, data: Partial<Lead>) =>
    request<Lead>(`/leads/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteLead: (id: string) => request<void>(`/leads/${id}`, { method: "DELETE" }),
  bulkUpdateStatus: (ids: string[], status: LeadStatus) =>
    request<{ updated: number }>("/leads/bulk-status", {
      method: "POST",
      body: JSON.stringify({ ids, status }),
    }),
  revealLead: (id: string) => request<Lead>(`/leads/${id}/reveal`, { method: "POST" }),
  sendLeadToCrm: (id: string) => request<Lead>(`/leads/${id}/send-to-crm`, { method: "POST" }),
  sendQualifiedToCrm: () =>
    request<{ totalQualified: number; alreadyInCrm: number; pushed: number; failed: number; failures: { id: string; fullName: string; error: string }[] }>(
      "/leads/send-qualified-to-crm",
      { method: "POST" }
    ),
  revealBulk: (ids: string[]) =>
    request<{ results: RevealResult[] }>("/leads/reveal-bulk", {
      method: "POST",
      body: JSON.stringify({ ids }),
    }),
  getLeadActivity: (leadId: string) => request<LeadActivityEvent[]>(`/leads/${leadId}/activity`),
  listResearchBriefs: (leadIds: string[]) =>
    leadIds.length === 0
      ? Promise.resolve<ResearchBrief[]>([])
      : request<ResearchBrief[]>(`/research?leadIds=${leadIds.join(",")}`),
  getResearchBrief: (leadId: string) =>
    request<ResearchBrief>(`/research/${leadId}`).catch(() => null),
  generateResearchBrief: (leadId: string, force = false) =>
    request<ResearchBrief>(`/research/${leadId}/generate`, {
      method: "POST",
      body: JSON.stringify({ force }),
    }),
  generateResearchBulk: (leadIds: string[], force = false) =>
    request<{ results: { leadId: string; brief?: ResearchBrief; error?: string }[] }>(
      "/research/generate-bulk",
      { method: "POST", body: JSON.stringify({ leadIds, force }) }
    ),
  updateResearchBrief: (leadId: string, data: Partial<ResearchBrief>) =>
    request<ResearchBrief>(`/research/${leadId}`, { method: "PATCH", body: JSON.stringify(data) }),

  listEmailDrafts: (leadIds: string[]) =>
    leadIds.length === 0
      ? Promise.resolve<EmailDraft[]>([])
      : request<EmailDraft[]>(`/email-drafts?leadIds=${leadIds.join(",")}`),
  getEmailDraft: (leadId: string) =>
    request<EmailDraft>(`/email-drafts/${leadId}`).catch(() => null),
  getEmailDraftPreview: (leadId: string) => request<EmailPreview>(`/email-drafts/${leadId}/preview`),
  generateEmailDraft: (leadId: string, force = false) =>
    request<EmailDraft>(`/email-drafts/${leadId}/generate`, {
      method: "POST",
      body: JSON.stringify({ force }),
    }),
  generateEmailDraftBulk: (leadIds: string[], force = false) =>
    request<{ results: { leadId: string; draft?: EmailDraft; error?: string }[] }>(
      "/email-drafts/generate-bulk",
      { method: "POST", body: JSON.stringify({ leadIds, force }) }
    ),
  updateEmailDraft: (leadId: string, data: Partial<EmailDraft>) =>
    request<EmailDraft>(`/email-drafts/${leadId}`, { method: "PATCH", body: JSON.stringify(data) }),
  sendEmailDraft: (leadId: string, force = false) =>
    request<EmailDraft>(`/email-drafts/${leadId}/send`, {
      method: "POST",
      body: JSON.stringify({ force }),
    }),
  sendEmailDraftBulk: (leadIds: string[], force = false) =>
    request<{ results: { leadId: string; draft?: EmailDraft; error?: string }[] }>(
      "/email-drafts/send-bulk",
      { method: "POST", body: JSON.stringify({ leadIds, force }) }
    ),

  getAutomationSettings: () => request<EmailAutomationSettings>("/automation/settings"),
  updateAutomationSettings: (data: Partial<EmailAutomationSettings>) =>
    request<EmailAutomationSettings>("/automation/settings", { method: "PUT", body: JSON.stringify(data) }),
  getFollowUpHistory: (leadId: string) =>
    request<{ tasks: FollowUpTask[]; messages: FollowUpMessage[]; dueStatus: FollowUpDueStatus | null }>(
      `/automation/follow-ups/${leadId}`
    ),
  sendFollowUpNow: (leadId: string) =>
    request<{ tasks: FollowUpTask[]; messages: FollowUpMessage[] }>(`/automation/follow-ups/${leadId}/send-now`, {
      method: "POST",
    }),

  exportCsv: async (ids: string[]) => {
    const res = await fetch("/api/leads/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    });
    if (!res.ok) throw new Error("Export failed");
    return res.blob();
  },

  // Automatic, webhook-derived engagement tracking (Email Engagement Analytics).
  listEngagementEvents: (leadIds: string[]) =>
    leadIds.length === 0
      ? Promise.resolve<EngagementEvent[]>([])
      : request<EngagementEvent[]>(`/engagement-events?leadIds=${leadIds.join(",")}`),
  getEngagementSummary: (leadIds: string[]) =>
    leadIds.length === 0
      ? Promise.resolve<EngagementSummary>({
          sentCount: 0,
          deliveredCount: 0,
          openedCount: 0,
          clickedCount: 0,
          bouncedCount: 0,
          complainedCount: 0,
          repliedCount: 0,
          deliveryRate: 0,
          openRate: 0,
          clickRate: 0,
          replyRate: 0,
          bounceRate: 0,
          complaintRate: 0,
        })
      : request<EngagementSummary>(`/analytics/engagement-summary?leadIds=${leadIds.join(",")}`),

  // Rich signature images — uploaded once, referenced inline from the
  // signature editor, embedded as a CID attachment only at send time.
  uploadSignatureImage: async (file: File): Promise<SignatureImageUploadResult> => {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch("/api/signature-images", { method: "POST", body: form });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(body.error ?? `Upload failed: ${res.status}`);
    }
    return res.json();
  },
  deleteSignatureImage: (id: string) => request<void>(`/signature-images/${id}`, { method: "DELETE" }),

  // Default attachments — separate setting from the signature, opted into
  // per-file, automatically merged into new sends/follow-ups.
  listAttachments: () => request<DefaultAttachment[]>("/attachments"),
  uploadAttachment: async (file: File): Promise<DefaultAttachment> => {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch("/api/attachments", { method: "POST", body: form });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(body.error ?? `Upload failed: ${res.status}`);
    }
    return res.json();
  },
  updateAttachment: (id: string, data: { includeByDefault: boolean }) =>
    request<DefaultAttachment>(`/attachments/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteAttachment: (id: string) => request<void>(`/attachments/${id}`, { method: "DELETE" }),

  // Master-database import wizard — upload/preview/commit only ever runs
  // against a bounded, backend-computed preview (sampleRecords/sampleErrors
  // are capped server-side); the full row set for a 654k-row workbook is
  // never sent to the browser.
  uploadImportFiles: async (files: File[], stagingId?: string): Promise<{ stagingId: string; files: UploadedFileDto[] }> => {
    const form = new FormData();
    for (const file of files) form.append("files", file);
    const qs = stagingId ? `?stagingId=${encodeURIComponent(stagingId)}` : "";
    const res = await fetch(`/api/import/uploads${qs}`, { method: "POST", body: form });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(body.error ?? `Upload failed: ${res.status}`);
    }
    return res.json();
  },
  previewImport: (stagingId: string, selections: ColumnMapping[]) =>
    request<{ digest: string; summary: ImportPreviewSummary }>(`/import/${stagingId}/preview`, {
      method: "POST",
      body: JSON.stringify({ selections }),
    }),
  commitImport: (stagingId: string, digest: string) =>
    request<ImportCommitResult>(`/import/${stagingId}/commit`, {
      method: "POST",
      body: JSON.stringify({ digest }),
    }),
  cancelImport: (stagingId: string) => request<void>(`/import/${stagingId}`, { method: "DELETE" }),
  importErrorsCsvUrl: (stagingId: string) => `/api/import/${stagingId}/errors.csv`,
};
