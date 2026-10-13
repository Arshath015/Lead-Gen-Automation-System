// Self-contained, client-side demo data layer — no network calls, nothing
// real is ever sent. Used only when VITE_DEMO_MODE=true (set on the public
// Vercel demo deployment's env vars, never in local/.env), so the real
// backend-backed app is completely untouched locally and in production.
import type {
  ConnectorStatus,
  DefaultAttachment,
  EmailAutomationSettings,
  EmailDraft,
  EmailPreview,
  EngagementEvent,
  EngagementSummary,
  IcpFilters,
  IcpProfile,
  ImportCommitResult,
  ImportPreviewSummary,
  Lead,
  LeadActivityEvent,
  LeadActivityType,
  LeadsPageResponse,
  LeadStatus,
  ResearchBrief,
  RevealResult,
  SignatureImageUploadResult,
  UploadedFileDto,
} from "../types";
import type { ApiClient } from "./client";

const now = () => new Date().toISOString();
const uuid = () => crypto.randomUUID();

// Resolves after a short, randomized delay so the demo feels like it's
// talking to a real network instead of popping instantly.
function delay<T>(value: T, ms = 350 + Math.random() * 350): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

const COMPANIES: { company: string; domain: string; industry: string }[] = [
  { company: "Northwind Analytics", domain: "northwindanalytics.io", industry: "Data & Analytics" },
  { company: "Brightfield Robotics", domain: "brightfieldrobotics.com", industry: "Robotics" },
  { company: "Cobalt Harbor Logistics", domain: "cobaltharbor.com", industry: "Logistics" },
  { company: "Lumen Ridge Health", domain: "lumenridgehealth.com", industry: "Healthcare" },
  { company: "Pinecrest Financial Group", domain: "pinecrestfg.com", industry: "Financial Services" },
  { company: "Verdant Cloud Systems", domain: "verdantcloud.io", industry: "Cloud Infrastructure" },
  { company: "Ashgrove Manufacturing", domain: "ashgrovemfg.com", industry: "Manufacturing" },
  { company: "Solace Retail Co.", domain: "solaceretail.com", industry: "Retail" },
  { company: "Ironleaf Biotech", domain: "ironleafbio.com", industry: "Biotech" },
  { company: "Mariner Point Insurance", domain: "marinerpoint.com", industry: "Insurance" },
  { company: "Hollowtree Energy", domain: "hollowtreeenergy.com", industry: "Energy" },
  { company: "Quartzline Media", domain: "quartzlinemedia.com", industry: "Media" },
  { company: "Birchwood Consulting", domain: "birchwoodconsulting.com", industry: "Consulting" },
  { company: "Fernhollow Education", domain: "fernholloweducation.com", industry: "Education" },
  { company: "Graylock Security", domain: "graylocksecurity.com", industry: "Cybersecurity" },
  { company: "Amberfield Agritech", domain: "amberfieldagri.com", industry: "Agriculture" },
  { company: "Stonebranch Realty", domain: "stonebranchrealty.com", industry: "Real Estate" },
  { company: "Tidewater Shipping", domain: "tidewatership.com", industry: "Shipping" },
  { company: "Cinderpeak Gaming", domain: "cinderpeakgaming.com", industry: "Gaming" },
  { company: "Mossgate Nonprofit Alliance", domain: "mossgatealliance.org", industry: "Nonprofit" },
];
const FIRST_NAMES = ["Alex", "Priya", "Jordan", "Maya", "Sam", "Elena", "Noah", "Zara", "Leo", "Fatima", "Omar", "Chloe", "Ravi", "Nina", "Theo", "Ingrid", "Diego", "Harper", "Kofi", "Saoirse"];
const LAST_NAMES = ["Carter", "Menon", "Walsh", "Rutherford", "Okafor", "Novak", "Pereira", "Lindqvist", "Hassan", "Beaumont", "Okonkwo", "Fontaine", "Desai", "Whitfield", "Nakamura", "Solberg", "Marsh", "Villanueva", "Abara", "Kowalski"];
const TITLES = ["VP of Operations", "Head of Growth", "Director of Engineering", "Chief of Staff", "VP Sales", "Head of Partnerships", "Director of Marketing", "COO", "Head of Product", "VP Customer Success"];
const LOCATIONS = ["Austin, TX", "Denver, CO", "Toronto, ON", "London, UK", "Singapore", "Berlin, DE", "Sydney, AU", "Chicago, IL", "Dublin, IE", "Bangalore, IN"];

function nameFor(i: number, j: number) {
  const first = FIRST_NAMES[(i * 3 + j) % FIRST_NAMES.length];
  const last = LAST_NAMES[(i * 5 + j * 2) % LAST_NAMES.length];
  return { first, last, fullName: `${first} ${last}` };
}

// ── In-memory state ─────────────────────────────────────────────────────────
let leads: Lead[] = [];
let icpProfiles: IcpProfile[] = [];
const researchBriefs = new Map<string, ResearchBrief>();
const emailDrafts = new Map<string, EmailDraft>();
const activity = new Map<string, LeadActivityEvent[]>();
const engagementEvents = new Map<string, EngagementEvent[]>();
let attachments: DefaultAttachment[] = [];
let automationSettings: EmailAutomationSettings = {
  paused: false,
  autoDraftEnabled: true,
  autoSendEnabled: false,
  autoFollowUpEnabled: true,
  dailySendLimit: 40,
  delayBetweenEmailsMinutes: 8,
  sendingDays: [1, 2, 3, 4, 5],
  sendingHourStart: 9,
  sendingHourEnd: 17,
  followUpCount: 2,
  followUpDelayDays: 3,
  emailSignature: "<p>Best,<br/>Demo Sender<br/>Outreach Demo</p>",
  updatedAt: now(),
};

function logActivity(leadId: string, type: LeadActivityType, summary: string, metadata: Record<string, unknown> | null = null, at = now()) {
  const list = activity.get(leadId) ?? [];
  list.push({ id: uuid(), leadId, type, summary, metadata, createdAt: at });
  activity.set(leadId, list);
}

function makeLead(i: number, j: number, icpProfileId: string | null, searchRunId: string | null): Lead {
  const company = COMPANIES[i % COMPANIES.length];
  const person = nameFor(i, j);
  return {
    id: uuid(),
    source: "apollo",
    sourceId: `demo-${i}-${j}`,
    dedupKey: `${person.fullName.toLowerCase()}@${company.domain}`,
    email: null,
    fullName: person.fullName,
    title: TITLES[(i + j) % TITLES.length],
    company: company.company,
    companyDomain: company.domain,
    linkedinUrl: `https://linkedin.com/in/${person.first.toLowerCase()}-${person.last.toLowerCase()}`,
    phone: null,
    location: LOCATIONS[(i + j * 2) % LOCATIONS.length],
    status: "new",
    icpProfileId,
    searchRunId,
    engagementStatus: "active",
    automationEnabled: true,
    roleCategory: null,
    industry: company.industry,
    sourceFile: null,
    sourceWorksheet: null,
    crmLeadId: null,
    crmPushedAt: null,
    createdAt: now(),
    updatedAt: now(),
  };
}

function statusCounts() {
  return {
    all: leads.length,
    new: leads.filter((l) => l.status === "new").length,
    qualified: leads.filter((l) => l.status === "qualified").length,
    rejected: leads.filter((l) => l.status === "rejected").length,
  };
}

function csvEscape(value: string) {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function seed() {
  icpProfiles = [
    {
      name: "Mid-Market Operations Leaders",
      filters: {
        personTitles: ["VP of Operations", "COO", "Director of Engineering"],
        personLocations: ["United States", "Canada"],
        organizationLocations: [],
        organizationDomains: [],
        employeeRanges: ["51-200", "201-500"],
        keywords: "operations efficiency, cost reduction",
      },
    },
    {
      name: "Growth & Partnerships",
      filters: {
        personTitles: ["Head of Growth", "Head of Partnerships", "VP Sales"],
        personLocations: ["United Kingdom", "Ireland", "Germany"],
        organizationLocations: [],
        organizationDomains: [],
        employeeRanges: ["11-50", "51-200"],
        keywords: "partnerships, go-to-market",
      },
    },
  ].map((p) => ({ id: uuid(), name: p.name, filters: p.filters as IcpFilters, createdAt: now(), updatedAt: now() }));

  const seeded: Lead[] = [];
  for (let i = 0; i < 9; i++) seeded.push(makeLead(i, 0, icpProfiles[i % icpProfiles.length].id, "seed-run-1"));
  leads = seeded;

  const reveal = (lead: Lead) => {
    const [first, last] = lead.fullName.split(" ");
    lead.email = `${first.toLowerCase()}.${last.toLowerCase()}@${lead.companyDomain}`;
  };

  // Lead 1: qualified, revealed
  leads[1].status = "qualified";
  reveal(leads[1]);
  logActivity(leads[1].id, "lead_created", "Lead added from search.");
  logActivity(leads[1].id, "status_changed", "Marked as qualified.");
  logActivity(leads[1].id, "email_revealed", "Email revealed via Apollo.");

  // Leads 2-4: qualified, revealed, researched + drafted
  const ageOffsets: Record<number, number> = { 3: 1728e5, 4: 2592e5 };
  for (const idx of [2, 3, 4]) {
    const lead = leads[idx];
    const base = ageOffsets[idx];
    const createdAt = base ? new Date(Date.now() - base - 1728e5).toISOString() : now();
    const revealedAt = base ? new Date(new Date(createdAt).getTime() + 12e4).toISOString() : now();
    const researchedAt = base ? new Date(new Date(createdAt).getTime() + 864e5).toISOString() : now();
    const draftedAt = base ? new Date(new Date(researchedAt).getTime() + 3e5).toISOString() : now();

    lead.status = "qualified";
    reveal(lead);
    logActivity(lead.id, "lead_created", "Lead added from search.", null, createdAt);
    logActivity(lead.id, "email_revealed", "Email revealed via Apollo.", null, revealedAt);

    const brief: ResearchBrief = {
      id: uuid(),
      leadId: lead.id,
      status: "complete",
      companyOverview: `${lead.company} is a ${lead.industry?.toLowerCase()} company known for steady growth and a lean, fast-moving team. Recent hiring activity suggests they're scaling their go-to-market function.`,
      recentNews: [
        {
          title: `${lead.company} announces new regional expansion`,
          url: `https://example.com/news/${lead.companyDomain}-expansion`,
          publishedAt: new Date(Date.now() - 12096e5).toISOString(),
          summary: `${lead.company} is opening a new office to support growing demand in its core market.`,
        },
        {
          title: `${lead.fullName} joins ${lead.company} as ${lead.title}`,
          url: `https://example.com/news/${lead.companyDomain}-hire`,
          publishedAt: new Date(Date.now() - 3456e6).toISOString(),
          summary: `${lead.fullName} previously led similar initiatives at a competitor before joining ${lead.company}.`,
        },
      ],
      painPoints: [
        "Manual processes slowing down cross-team handoffs",
        "Limited visibility into pipeline health across regions",
        "Headcount growth is outpacing existing tooling",
      ],
      sources: [
        { title: `${lead.company} Newsroom`, url: `https://example.com/news/${lead.companyDomain}` },
        { title: `${lead.fullName} — LinkedIn`, url: lead.linkedinUrl ?? "https://linkedin.com" },
      ],
      model: "demo-research-model",
      editedByUser: false,
      error: null,
      createdAt: now(),
      updatedAt: now(),
    };
    researchBriefs.set(lead.id, brief);
    logActivity(lead.id, "research_completed", "Research brief generated.", null, researchedAt);

    const draft: EmailDraft = {
      id: uuid(),
      leadId: lead.id,
      researchBriefId: brief.id,
      subject: `Quick idea for ${lead.company}'s ${lead.industry?.toLowerCase()} team`,
      body: `Hi ${lead.fullName.split(" ")[0]},\n\nCongrats on the recent expansion at ${lead.company} — exciting stage to be scaling through.\n\nA few teams in similar spots have mentioned ${brief.painPoints[0].toLowerCase()} as the thing slowing them down most. Worth a quick chat about how we've helped with that?\n\nBest,\nDemo Sender`,
      model: "demo-draft-model",
      editedByUser: false,
      generatedAt: now(),
      updatedAt: now(),
      sendStatus: "not_sent",
      sentAt: null,
      resendMessageId: null,
      sendError: null,
    };
    emailDrafts.set(lead.id, draft);
    logActivity(lead.id, "draft_generated", "Email draft generated.", null, draftedAt);
  }

  // Lead 4: sent + full engagement history (delivered, opened, clicked, opened again, replied)
  {
    const lead = leads[4];
    const draft = emailDrafts.get(lead.id)!;
    const sentAt = new Date(Date.now() - 2592e5).toISOString();
    const deliveredAt = new Date(new Date(sentAt).getTime() + 12e4).toISOString();
    const openedAt = new Date(new Date(sentAt).getTime() + 282e4).toISOString();
    const clickedAt = new Date(new Date(openedAt).getTime() + 3e5).toISOString();
    const reopenedAt = new Date(new Date(sentAt).getTime() + 972e5).toISOString();
    const repliedAt = new Date(new Date(sentAt).getTime() + 1908e5).toISOString();

    draft.sendStatus = "sent";
    draft.sentAt = sentAt;
    draft.resendMessageId = `demo-msg-${lead.id.slice(0, 8)}`;
    logActivity(lead.id, "email_sent", "Email sent.", null, sentAt);

    const approxLocation = { country: "United States", region: "Texas", city: "Austin", approximate: true as const, likelyProxied: false };
    const proxyLocation = { country: null, region: null, city: null, approximate: true as const, likelyProxied: true };
    const calLink = "https://cal.com/outreach-demo/intro-call";

    engagementEvents.set(lead.id, [
      { id: uuid(), webhookEventId: uuid(), type: "delivered", emailId: draft.resendMessageId, messageId: draft.resendMessageId, leadId: lead.id, occurredAt: deliveredAt, ip: null, userAgent: null, clickedLink: null, location: null, createdAt: deliveredAt },
      { id: uuid(), webhookEventId: uuid(), type: "opened", emailId: draft.resendMessageId, messageId: draft.resendMessageId, leadId: lead.id, occurredAt: openedAt, ip: "203.0.113.4", userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", clickedLink: null, location: approxLocation, createdAt: openedAt },
      { id: uuid(), webhookEventId: uuid(), type: "clicked", emailId: draft.resendMessageId, messageId: draft.resendMessageId, leadId: lead.id, occurredAt: clickedAt, ip: "203.0.113.4", userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", clickedLink: calLink, location: approxLocation, createdAt: clickedAt },
      { id: uuid(), webhookEventId: uuid(), type: "opened", emailId: draft.resendMessageId, messageId: draft.resendMessageId, leadId: lead.id, occurredAt: reopenedAt, ip: "66.102.8.145", userAgent: "GoogleImageProxy", clickedLink: null, location: proxyLocation, createdAt: reopenedAt },
      { id: uuid(), webhookEventId: uuid(), type: "received", emailId: draft.resendMessageId, messageId: draft.resendMessageId, leadId: lead.id, occurredAt: repliedAt, ip: "203.0.113.4", userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", clickedLink: null, location: approxLocation, createdAt: repliedAt },
    ]);
    logActivity(lead.id, "webhook_delivered", "Email delivered.", null, deliveredAt);
    logActivity(lead.id, "webhook_opened", "Email opened from Austin, TX, United States.", null, openedAt);
    logActivity(lead.id, "webhook_clicked", `Link clicked: ${calLink}`, null, clickedAt);
    logActivity(lead.id, "webhook_opened", "Email opened again (routed through an email provider proxy).", null, reopenedAt);
    logActivity(lead.id, "webhook_replied", "Prospect replied to the outreach email.", null, repliedAt);
    lead.engagementStatus = "replied";
    lead.updatedAt = repliedAt;
  }

  // Lead 3: sent + bounced
  {
    const lead = leads[3];
    const draft = emailDrafts.get(lead.id)!;
    const sentAt = new Date(Date.now() - 1728e5).toISOString();
    const bouncedAt = new Date(new Date(sentAt).getTime() + 24e4).toISOString();
    draft.sendStatus = "sent";
    draft.sentAt = sentAt;
    draft.resendMessageId = `demo-msg-${lead.id.slice(0, 8)}`;
    logActivity(lead.id, "email_sent", "Email sent.", null, sentAt);
    engagementEvents.set(lead.id, [
      { id: uuid(), webhookEventId: uuid(), type: "bounced", emailId: draft.resendMessageId, messageId: draft.resendMessageId, leadId: lead.id, occurredAt: bouncedAt, ip: null, userAgent: null, clickedLink: null, location: null, createdAt: bouncedAt },
    ]);
    logActivity(lead.id, "webhook_bounced", "Email bounced — delivery failed (mailbox does not exist).", null, bouncedAt);
    lead.engagementStatus = "bounced";
    lead.updatedAt = bouncedAt;
  }

  // Leads 5-6: rejected
  for (const idx of [5, 6]) {
    leads[idx].status = "rejected";
    logActivity(leads[idx].id, "status_changed", "Marked as rejected.");
  }
}
seed();

export const mockApi: ApiClient = {
  getConfig: () => delay({ emailFrom: "demo-sender@outreach-demo.example" }),
  listConnectors: (): Promise<ConnectorStatus[]> => delay([{ name: "apollo", capabilities: ["search", "revealContact"], configured: true }]),

  listIcpProfiles: () => delay([...icpProfiles]),
  createIcpProfile: (name: string, filters: IcpFilters) => {
    const profile: IcpProfile = { id: uuid(), name, filters, createdAt: now(), updatedAt: now() };
    icpProfiles = [...icpProfiles, profile];
    return delay(profile);
  },
  updateIcpProfile: (id: string, data: { name?: string; filters?: IcpFilters }) => {
    const idx = icpProfiles.findIndex((p) => p.id === id);
    if (idx === -1) return Promise.reject(new Error("ICP profile not found"));
    icpProfiles[idx] = { ...icpProfiles[idx], ...data, updatedAt: now() };
    return delay(icpProfiles[idx]);
  },
  deleteIcpProfile: (id: string) => {
    icpProfiles = icpProfiles.filter((p) => p.id !== id);
    return delay(undefined);
  },

  runSearch: (icpProfileId: string, _page?: number, perPage = 25) => {
    const existingSourceIds = new Set(leads.map((l) => l.sourceId));
    const created: Lead[] = [];
    let i = leads.length;
    let guard = 0;
    while (created.length < Math.min(perPage, 6) && guard < 200) {
      guard++;
      const candidate = makeLead(i % COMPANIES.length, Math.floor(i / COMPANIES.length), icpProfileId, uuid());
      i++;
      if (!existingSourceIds.has(candidate.sourceId)) {
        created.push(candidate);
        existingSourceIds.add(candidate.sourceId);
      }
    }
    leads = [...leads, ...created];
    for (const lead of created) logActivity(lead.id, "lead_created", "Lead added from search.");
    return delay(
      { inserted: created.length, skippedDuplicates: 0, fetched: created.length, totalAvailable: COMPANIES.length * 10, page: 1, keywordDropped: false },
      900
    );
  },

  listLeads: (params: { status?: string; icpProfileId?: string; search?: string; limit?: number; offset?: number } = {}): Promise<LeadsPageResponse> => {
    let filtered = [...leads];
    if (params.status) filtered = filtered.filter((l) => l.status === params.status);
    if (params.icpProfileId) filtered = filtered.filter((l) => l.icpProfileId === params.icpProfileId);
    if (params.search) {
      const term = params.search.toLowerCase();
      filtered = filtered.filter((l) => l.fullName.toLowerCase().includes(term) || (l.company ?? "").toLowerCase().includes(term));
    }
    const limit = params.limit ?? 50;
    const offset = params.offset ?? 0;
    return delay({ leads: filtered.slice(offset, offset + limit), total: filtered.length, limit, offset, statusCounts: statusCounts() });
  },
  createLead: (data: { fullName: string; title?: string; company?: string; email?: string; location?: string; linkedinUrl?: string }) => {
    const lead: Lead = {
      id: uuid(),
      source: "manual",
      sourceId: uuid(),
      dedupKey: `${data.fullName.toLowerCase()}@${data.company ?? "unknown"}`,
      email: data.email ?? null,
      fullName: data.fullName,
      title: data.title ?? null,
      company: data.company ?? null,
      companyDomain: null,
      linkedinUrl: data.linkedinUrl ?? null,
      phone: null,
      location: data.location ?? null,
      status: "new",
      icpProfileId: null,
      searchRunId: null,
      engagementStatus: "active",
      automationEnabled: true,
      roleCategory: null,
      industry: null,
      sourceFile: null,
      sourceWorksheet: null,
      crmLeadId: null,
      crmPushedAt: null,
      createdAt: now(),
      updatedAt: now(),
    };
    leads = [...leads, lead];
    logActivity(lead.id, "lead_created", "Lead added manually.");
    return delay(lead);
  },
  updateLead: (id: string, data: Partial<Lead>) => {
    const idx = leads.findIndex((l) => l.id === id);
    if (idx === -1) return Promise.reject(new Error("Lead not found"));
    const prev = leads[idx];
    leads[idx] = { ...prev, ...data, updatedAt: now() };
    if (data.status && data.status !== prev.status) logActivity(id, "status_changed", `Marked as ${data.status}.`);
    if (data.engagementStatus && data.engagementStatus !== prev.engagementStatus)
      logActivity(id, "engagement_changed", `Engagement set to ${data.engagementStatus}.`);
    if (data.automationEnabled !== undefined && data.automationEnabled !== prev.automationEnabled)
      logActivity(id, "automation_toggled", data.automationEnabled ? "Automation enabled." : "Automation paused.");
    return delay(leads[idx]);
  },
  deleteLead: (id: string) => {
    leads = leads.filter((l) => l.id !== id);
    researchBriefs.delete(id);
    emailDrafts.delete(id);
    activity.delete(id);
    return delay(undefined);
  },
  bulkUpdateStatus: (ids: string[], status: LeadStatus) => {
    let updated = 0;
    leads = leads.map((l) => {
      if (!ids.includes(l.id)) return l;
      updated++;
      logActivity(l.id, "status_changed", `Marked as ${status}.`);
      return { ...l, status, updatedAt: now() };
    });
    return delay({ updated });
  },
  revealLead: (id: string) => {
    const lead = leads.find((l) => l.id === id);
    if (!lead) return Promise.reject(new Error("Lead not found"));
    if (!lead.email) {
      const [first, last] = lead.fullName.split(" ");
      lead.email = `${first.toLowerCase()}.${(last ?? "").toLowerCase()}@${lead.companyDomain ?? "example.com"}`;
      lead.updatedAt = now();
      logActivity(id, "email_revealed", "Email revealed via Apollo.");
    }
    return delay(lead, 600);
  },
  sendLeadToCrm: (id: string) => {
    const idx = leads.findIndex((l) => l.id === id);
    if (idx === -1) return Promise.reject(new Error("Lead not found"));
    leads[idx] = { ...leads[idx], crmLeadId: Math.floor(Math.random() * 1e5), crmPushedAt: now(), updatedAt: now() };
    logActivity(id, "sent_to_crm", "Pushed to Rapport CRM.");
    return delay(leads[idx], 500);
  },
  sendQualifiedToCrm: () => {
    const toPush = leads.filter((l) => l.status === "qualified" && !l.crmLeadId);
    for (const lead of toPush) {
      lead.crmLeadId = Math.floor(Math.random() * 1e5);
      lead.crmPushedAt = now();
      logActivity(lead.id, "sent_to_crm", "Pushed to Rapport CRM.");
    }
    return delay({
      totalQualified: leads.filter((l) => l.status === "qualified").length,
      alreadyInCrm: leads.filter((l) => l.status === "qualified" && l.crmLeadId).length - toPush.length,
      pushed: toPush.length,
      failed: 0,
      failures: [] as { id: string; fullName: string; error: string }[],
    });
  },
  revealBulk: (ids: string[]): Promise<{ results: RevealResult[] }> =>
    delay(
      {
        results: ids.map((id): RevealResult => {
          const lead = leads.find((l) => l.id === id);
          if (!lead) return { id, fullName: "Unknown", email: null, outcome: "failed", error: "Lead not found" };
          if (lead.email) return { id, fullName: lead.fullName, email: lead.email, outcome: "already_revealed" };
          const [first, last] = lead.fullName.split(" ");
          lead.email = `${first.toLowerCase()}.${(last ?? "").toLowerCase()}@${lead.companyDomain ?? "example.com"}`;
          lead.updatedAt = now();
          logActivity(id, "email_revealed", "Email revealed via Apollo.");
          return { id, fullName: lead.fullName, email: lead.email, outcome: "revealed" };
        }),
      },
      900
    ),
  getLeadActivity: (leadId: string) => delay([...(activity.get(leadId) ?? [])]),

  listResearchBriefs: (leadIds: string[]) => delay(leadIds.map((id) => researchBriefs.get(id)).filter((b): b is ResearchBrief => !!b)),
  getResearchBrief: (leadId: string) => delay(researchBriefs.get(leadId) ?? null),
  generateResearchBrief: (leadId: string) => {
    const lead = leads.find((l) => l.id === leadId);
    if (!lead) return Promise.reject(new Error("Lead not found"));
    const brief: ResearchBrief = {
      id: uuid(),
      leadId,
      status: "complete",
      companyOverview: `${lead.company} operates in ${lead.industry ?? "its market"} and has shown steady hiring momentum over the past two quarters.`,
      recentNews: [
        {
          title: `${lead.company} featured in industry roundup`,
          url: `https://example.com/news/${lead.companyDomain}`,
          publishedAt: new Date(Date.now() - 864e6).toISOString(),
          summary: `${lead.company} was highlighted for its approach to ${(lead.industry ?? "its industry").toLowerCase()}.`,
        },
      ],
      painPoints: ["Fragmented tooling across teams", "Slow manual reporting cycles", "Difficulty scaling outbound without more headcount"],
      sources: [{ title: `${lead.company} site`, url: `https://${lead.companyDomain}` }],
      model: "demo-research-model",
      editedByUser: false,
      error: null,
      createdAt: now(),
      updatedAt: now(),
    };
    researchBriefs.set(leadId, brief);
    logActivity(leadId, "research_completed", "Research brief generated.");
    return delay(brief, 1100);
  },
  generateResearchBulk: async (leadIds: string[]) => {
    const results: { leadId: string; brief?: ResearchBrief; error?: string }[] = [];
    for (const leadId of leadIds) {
      try {
        const brief = await mockApi.generateResearchBrief(leadId);
        results.push({ leadId, brief });
      } catch (e) {
        results.push({ leadId, error: (e as Error).message });
      }
    }
    return { results };
  },
  updateResearchBrief: (leadId: string, data: Partial<ResearchBrief>) => {
    const existing = researchBriefs.get(leadId);
    if (!existing) return Promise.reject(new Error("Research brief not found"));
    const updated = { ...existing, ...data, editedByUser: true, updatedAt: now() };
    researchBriefs.set(leadId, updated);
    return delay(updated);
  },

  listEmailDrafts: (leadIds: string[]) => delay(leadIds.map((id) => emailDrafts.get(id)).filter((d): d is EmailDraft => !!d)),
  getEmailDraft: (leadId: string) => delay(emailDrafts.get(leadId) ?? null),
  getEmailDraftPreview: (leadId: string): Promise<EmailPreview> => {
    const draft = emailDrafts.get(leadId);
    if (!draft) return Promise.reject(new Error("Draft not found"));
    return delay({ text: draft.body, html: draft.body.replace(/\n/g, "<br/>"), attachments: [] });
  },
  generateEmailDraft: (leadId: string) => {
    const lead = leads.find((l) => l.id === leadId);
    const brief = researchBriefs.get(leadId);
    if (!lead) return Promise.reject(new Error("Lead not found"));
    const painPoint = brief?.painPoints[0]?.toLowerCase() ?? "scaling their current process";
    const draft: EmailDraft = {
      id: uuid(),
      leadId,
      researchBriefId: brief?.id ?? null,
      subject: `Quick idea for ${lead.company}`,
      body: `Hi ${lead.fullName.split(" ")[0]},\n\nNoticed ${lead.company} has been growing fast. A few teams like yours have mentioned ${painPoint} — worth a quick chat?\n\nBest,\nDemo Sender`,
      model: "demo-draft-model",
      editedByUser: false,
      generatedAt: now(),
      updatedAt: now(),
      sendStatus: "not_sent",
      sentAt: null,
      resendMessageId: null,
      sendError: null,
    };
    emailDrafts.set(leadId, draft);
    logActivity(leadId, "draft_generated", "Email draft generated.");
    return delay(draft, 1000);
  },
  generateEmailDraftBulk: async (leadIds: string[]) => {
    const results: { leadId: string; draft?: EmailDraft; error?: string }[] = [];
    for (const leadId of leadIds) {
      try {
        const draft = await mockApi.generateEmailDraft(leadId);
        results.push({ leadId, draft });
      } catch (e) {
        results.push({ leadId, error: (e as Error).message });
      }
    }
    return { results };
  },
  updateEmailDraft: (leadId: string, data: Partial<EmailDraft>) => {
    const existing = emailDrafts.get(leadId);
    if (!existing) return Promise.reject(new Error("Draft not found"));
    const updated = { ...existing, ...data, editedByUser: true, updatedAt: now() };
    emailDrafts.set(leadId, updated);
    logActivity(leadId, "draft_edited", "Email draft edited.");
    return delay(updated);
  },
  sendEmailDraft: (leadId: string) => {
    const draft = emailDrafts.get(leadId);
    const lead = leads.find((l) => l.id === leadId);
    if (!draft || !lead) return Promise.reject(new Error("Draft or lead not found"));
    if (!lead.email) return Promise.reject(new Error("Lead's email has not been revealed yet"));
    const updated: EmailDraft = { ...draft, sendStatus: "sent", sentAt: now(), resendMessageId: `demo-msg-${uuid().slice(0, 8)}`, sendError: null, updatedAt: now() };
    emailDrafts.set(leadId, updated);
    logActivity(leadId, "email_sent", "Email sent.");
    engagementEvents.set(leadId, [
      ...(engagementEvents.get(leadId) ?? []),
      { id: uuid(), webhookEventId: uuid(), type: "delivered", emailId: updated.resendMessageId, messageId: updated.resendMessageId, leadId, occurredAt: now(), ip: null, userAgent: null, clickedLink: null, location: null, createdAt: now() },
    ]);
    return delay(updated, 700);
  },
  sendEmailDraftBulk: async (leadIds: string[]) => {
    const results: { leadId: string; draft?: EmailDraft; error?: string }[] = [];
    for (const leadId of leadIds) {
      try {
        const draft = await mockApi.sendEmailDraft(leadId);
        results.push({ leadId, draft });
      } catch (e) {
        results.push({ leadId, error: (e as Error).message });
      }
    }
    return { results };
  },

  getAutomationSettings: () => delay({ ...automationSettings }),
  updateAutomationSettings: (data: Partial<EmailAutomationSettings>) => {
    automationSettings = { ...automationSettings, ...data, updatedAt: now() };
    return delay({ ...automationSettings });
  },
  getFollowUpHistory: () => delay({ tasks: [], messages: [], dueStatus: { reason: "ready" as const, message: "This is a demo — follow-up scheduling isn't simulated." } }),
  sendFollowUpNow: () => delay({ tasks: [], messages: [] }),

  exportCsv: async (ids: string[]): Promise<Blob> => {
    const rows = leads.filter((l) => ids.length === 0 || ids.includes(l.id));
    const csv = [["Full Name", "Title", "Company", "Email", "Location", "Status"].join(",")]
      .concat(rows.map((l) => [l.fullName, l.title ?? "", l.company ?? "", l.email ?? "", l.location ?? "", l.status].map((v) => csvEscape(String(v))).join(",")))
      .join("\n");
    return new Blob([csv], { type: "text/csv" });
  },

  listEngagementEvents: (leadIds: string[]) => delay(leadIds.flatMap((id) => engagementEvents.get(id) ?? [])),
  getEngagementSummary: (leadIds: string[]): Promise<EngagementSummary> => {
    const events = leadIds.flatMap((id) => engagementEvents.get(id) ?? []);
    const sentCount = leadIds.filter((id) => emailDrafts.get(id)?.sendStatus === "sent").length;
    const count = (t: EngagementEvent["type"]) => events.filter((e) => e.type === t).length;
    const delivered = count("delivered");
    const opened = count("opened");
    const clicked = count("clicked");
    const bounced = count("bounced");
    const complained = count("complained");
    const replied = count("received");
    const rate = (n: number, d: number) => (d > 0 ? n / d : 0);
    return delay({
      sentCount,
      deliveredCount: delivered,
      openedCount: opened,
      clickedCount: clicked,
      bouncedCount: bounced,
      complainedCount: complained,
      repliedCount: replied,
      deliveryRate: rate(delivered, sentCount),
      openRate: rate(opened, delivered),
      clickRate: rate(clicked, delivered),
      replyRate: rate(replied, sentCount),
      bounceRate: rate(bounced, sentCount),
      complaintRate: rate(complained, sentCount),
    });
  },

  uploadSignatureImage: async (file: File): Promise<SignatureImageUploadResult> =>
    delay({ id: uuid(), url: URL.createObjectURL(file), filename: file.name, contentType: file.type, sizeBytes: file.size }),
  deleteSignatureImage: () => delay(undefined),

  listAttachments: () => delay([...attachments]),
  uploadAttachment: async (file: File): Promise<DefaultAttachment> => {
    const attachment: DefaultAttachment = { id: uuid(), filename: file.name, contentType: file.type, sizeBytes: file.size, includeByDefault: false, createdAt: now() };
    attachments = [...attachments, attachment];
    return delay(attachment);
  },
  updateAttachment: (id: string, data: { includeByDefault: boolean }) => {
    attachments = attachments.map((a) => (a.id === id ? { ...a, ...data } : a));
    const updated = attachments.find((a) => a.id === id);
    if (!updated) return Promise.reject(new Error("Attachment not found"));
    return delay(updated);
  },
  deleteAttachment: (id: string) => {
    attachments = attachments.filter((a) => a.id !== id);
    return delay(undefined);
  },

  uploadImportFiles: async (files: File[], stagingId?: string): Promise<{ stagingId: string; files: UploadedFileDto[] }> => {
    const id = stagingId ?? uuid();
    const headers = ["Company", "Contact Name", "Title", "Email", "Phone", "City", "State"];
    return delay({
      stagingId: id,
      files: files.map((file) => ({
        fileId: uuid(),
        originalFilename: file.name,
        worksheets: [
          {
            name: "Sheet1",
            headerRowNumber: 1,
            headers,
            approxDataRowCount: 42,
            suggestedMapping: { company: 0, contactName: 1, designation: 2, email: 3, phone: 4, city: 5, state: 6 },
            missingFields: [],
            unmappedColumns: [],
            duplicateHeaders: [],
            importable: true,
          },
        ],
      })),
    });
  },
  previewImport: (stagingId: string): Promise<{ digest: string; summary: ImportPreviewSummary }> =>
    delay({
      digest: `demo-digest-${stagingId.slice(0, 8)}`,
      summary: {
        sheets: [
          {
            fileId: stagingId,
            originalFilename: "demo-import.xlsx",
            sheetName: "Sheet1",
            totalRows: 42,
            validRows: 38,
            invalidRows: 4,
            duplicateExistingRows: 2,
            duplicateInFileRows: 1,
            rowsWithInvalidEmailFormat: 1,
            blankFieldCounts: {},
            willImportRows: 35,
          },
        ],
        totals: { totalRows: 42, validRows: 38, invalidRows: 4, duplicateExistingRows: 2, duplicateInFileRows: 1, rowsWithInvalidEmailFormat: 1, willImportRows: 35 },
        sampleRecords: [
          {
            company: "Demo Sample Co.",
            fullName: "Sample Person",
            title: "Operations Manager",
            roleCategory: null,
            email: "sample.person@example.com",
            emailValid: true,
            phone: null,
            location: "Austin, TX",
            city: "Austin",
            state: "TX",
            industry: null,
            sourceFile: "demo-import.xlsx",
          },
        ],
        sampleErrors: [{ fileId: stagingId, originalFilename: "demo-import.xlsx", sheetName: "Sheet1", rowNumber: 7, reason: "Missing email address" }],
      },
    }),
  commitImport: (): Promise<ImportCommitResult> => {
    const imported: Lead[] = [];
    for (let i = 0; i < 3; i++) {
      const lead = makeLead(leads.length + i, 0, null, null);
      lead.source = "import";
      lead.sourceFile = "demo-import.xlsx";
      imported.push(lead);
    }
    leads = [...leads, ...imported];
    for (const lead of imported) logActivity(lead.id, "lead_created", "Lead imported from spreadsheet.");
    return delay({ imported: imported.length, skippedDuplicates: 2, invalidRows: 4, failedRows: 0, aborted: false, abortReason: null, errorRowCount: 1 }, 900);
  },
  cancelImport: () => delay(undefined),
  importErrorsCsvUrl: () => `data:text/csv;charset=utf-8,Row,Reason%0A7,Missing%20email%20address`,
};
