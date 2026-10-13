// Self-contained, client-side CRM demo — patches window.fetch so every API
// call (both the generated api-client-react hooks and the direct
// /api/auth/user check in replit-auth-web) is answered from in-memory seed
// data instead of a real backend. Installed only when VITE_DEMO_MODE=true
// (set on the rapport-crm-demo Vercel project's env vars, never locally),
// so local dev and any real deployment are completely unaffected.
//
// Covers a curated tour — Dashboard, Leads, Deals, Contacts, Accounts,
// Reports — plus the cross-cutting lookups those pages depend on (users,
// stages, tags). Admin-only pages (Users, Roles, Audit, Approvals, Import,
// Automation Rules) are hidden from nav by the demo user's permission set,
// not by this router, so they're intentionally left unmocked.

let nextId = 1;
const id = () => nextId++;

const now = () => new Date().toISOString();
const isoDaysFromNow = (days: number) => new Date(Date.now() + days * 86400000).toISOString();
const isoDaysAgo = (days: number) => isoDaysFromNow(-days);
const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

function rand<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}
function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// ── Seed vocabulary ─────────────────────────────────────────────────────────

const COMPANIES = [
  { name: "Northwind Analytics", industry: "Data & Analytics", location: "Austin, TX" },
  { name: "Brightfield Robotics", industry: "Robotics", location: "Denver, CO" },
  { name: "Cobalt Harbor Logistics", industry: "Logistics", location: "Toronto, ON" },
  { name: "Lumen Ridge Health", industry: "Healthcare", location: "London, UK" },
  { name: "Pinecrest Financial Group", industry: "Financial Services", location: "Singapore" },
  { name: "Verdant Cloud Systems", industry: "Cloud Infrastructure", location: "Berlin, DE" },
  { name: "Ashgrove Manufacturing", industry: "Manufacturing", location: "Sydney, AU" },
  { name: "Solace Retail Co.", industry: "Retail", location: "Chicago, IL" },
  { name: "Ironleaf Biotech", industry: "Biotech", location: "Dublin, IE" },
  { name: "Mariner Point Insurance", industry: "Insurance", location: "Bangalore, IN" },
  { name: "Hollowtree Energy", industry: "Energy", location: "Houston, TX" },
  { name: "Quartzline Media", industry: "Media", location: "Los Angeles, CA" },
  { name: "Birchwood Consulting", industry: "Consulting", location: "New York, NY" },
  { name: "Fernhollow Education", industry: "Education", location: "Boston, MA" },
  { name: "Graylock Security", industry: "Cybersecurity", location: "San Francisco, CA" },
  { name: "Amberfield Agritech", industry: "Agriculture", location: "Des Moines, IA" },
  { name: "Stonebranch Realty", industry: "Real Estate", location: "Miami, FL" },
  { name: "Tidewater Shipping", industry: "Shipping", location: "Seattle, WA" },
  { name: "Cinderpeak Gaming", industry: "Gaming", location: "Vancouver, BC" },
  { name: "Mossgate Nonprofit Alliance", industry: "Nonprofit", location: "Portland, OR" },
];
const FIRST_NAMES = ["Alex", "Priya", "Jordan", "Maya", "Sam", "Elena", "Noah", "Zara", "Leo", "Fatima", "Omar", "Chloe", "Ravi", "Nina", "Theo", "Ingrid", "Diego", "Harper", "Kofi", "Saoirse"];
const LAST_NAMES = ["Carter", "Menon", "Walsh", "Rutherford", "Okafor", "Novak", "Pereira", "Lindqvist", "Hassan", "Beaumont", "Okonkwo", "Fontaine", "Desai", "Whitfield", "Nakamura", "Solberg", "Marsh", "Villanueva", "Abara", "Kowalski"];
const TITLES = ["VP of Operations", "Head of Growth", "Director of Engineering", "Chief of Staff", "VP Sales", "Head of Partnerships", "Director of Marketing", "COO", "Head of Product", "VP Customer Success"];

function personName(i: number): { first: string; last: string; full: string } {
  const first = FIRST_NAMES[i % FIRST_NAMES.length];
  const last = LAST_NAMES[(i * 7) % LAST_NAMES.length];
  return { first, last, full: `${first} ${last}` };
}

// ── Entity shapes (mirrors crm/lib/api-spec/openapi.yaml) ──────────────────

interface DemoUser {
  id: number; replitId: string; username: string; firstName: string; lastName: string;
  email: string; profileImage: string | null; role: string; roleId: null; teamId: null;
  managerId: number | null; targetAmount: null; isActive: boolean; createdAt: string;
}
interface Stage { id: number; name: string; color: string; order: number; isDefault: boolean; isWon: boolean; isLost: boolean; type: "lead" | "deal"; }
interface Tag { id: number; name: string; color: string; }
interface Account {
  id: number; name: string; industry: string | null; website: string | null; size: string | null;
  phone: string | null; location: string | null; notes: string | null; ownerId: number | null;
  ownerName: string | null; createdById: number | null; createdAt: string; updatedAt: string;
}
interface Contact {
  id: number; firstName: string; lastName: string | null; email: string | null; phone: string | null;
  title: string | null; accountId: number | null; accountName: string | null; ownerId: number | null;
  ownerName: string | null; notes: string | null; createdById: number | null; createdAt: string; updatedAt: string;
}
interface Deal {
  id: number; name: string; value: string | null; currency: string; stageId: number | null;
  stageName: string | null; stageColor: string | null; closeDate: string | null; probability: number | null;
  accountId: number | null; accountName: string | null; contactId: number | null; contactName: string | null;
  convertedFromLeadId: number | null; ownerId: number | null; ownerName: string | null; notes: string | null;
  createdById: number | null; createdAt: string; updatedAt: string;
}
interface Lead {
  id: number; companyName: string; contactPerson: string; email: string | null; phone: string | null;
  location: string | null; designation: string | null; industry: string | null; linkedinUrl: string | null;
  websiteUrl: string | null; remarks: string | null; comment: string | null; source: string;
  priority: string | null; channel: string | null; valueAmount: string | null; currency: string;
  expectedCloseDate: string | null; nextFollowUpAt: string | null; tags: Tag[]; stageId: number;
  stageName: string | null; stageColor: string | null; ownerId: number | null; ownerName: string | null;
  createdById: number | null; createdAt: string; updatedAt: string;
}
interface Note {
  id: number; leadId: number; content: string; type: string; createdById: number | null;
  createdByName: string | null; createdByAvatar: string | null; createdAt: string; updatedAt: string;
}
interface CrmNote {
  id: number; leadId: number | null; contactId: number | null; dealId: number | null; type: string;
  content: string; createdById: number | null; createdByName: string | null; createdByAvatar: string | null;
  createdAt: string; updatedAt: string;
}
interface Followup {
  id: number; leadId: number; scheduledAt: string; notes: string | null; status: string;
  createdById: number | null; createdByName: string | null; createdAt: string; updatedAt: string;
}
interface Activity {
  id: number; leadId: number; type: string; description: string; oldValue: string | null;
  newValue: string | null; userId: number | null; userName: string | null; userAvatar: string | null; createdAt: string;
}
interface Task {
  id: number; leadId: number | null; leadCompanyName: string | null; assignedToId: number | null;
  assignedToName: string | null; createdById: number | null; createdByName: string | null; title: string;
  description: string | null; dueDate: string | null; status: string; priority: string;
  createdAt: string; updatedAt: string;
}
interface ScheduledActivity {
  id: number; type: string; subject: string; leadId: number | null; leadCompanyName: string | null;
  ownerId: number | null; ownerName: string | null; dueAt: string; priority: string; status: string;
  notes: string | null; completedAt: string | null; createdById: number | null; createdByName: string | null;
  createdAt: string; updatedAt: string;
}
interface AuditLog {
  id: number; leadId: number | null; leadCompanyName: string | null; userId: number | null;
  userName: string | null; action: string; tableName: string | null; fieldName: string | null;
  oldValue: string | null; newValue: string | null; ipAddress: string | null; createdAt: string;
}
interface DealRevenueEntry {
  id: number; dealId: number; amount: string; month: string; note: string | null;
  createdById: number | null; createdByName: string | null; workspaceId: null; createdAt: string; updatedAt: string;
}
interface Attachment { id: number; leadId: number; fileName: string; fileSize: number | null; mimeType: string | null; uploadedById: number | null; uploadedByName: string | null; createdAt: string; }
interface Notification { id: number; userId: number; type: string; title: string; body: string | null; read: boolean; leadId: number | null; leadCompanyName: string | null; taskId: null; followupId: null; createdAt: string; }

// ── In-memory store ─────────────────────────────────────────────────────────

const DEMO_USER_ID = 1;

const users: DemoUser[] = [
  { id: 1, replitId: "demo-1", username: "demo", firstName: "Demo", lastName: "Admin", email: "demo@rapport.dev", profileImage: null, role: "admin", roleId: null, teamId: null, managerId: null, targetAmount: null, isActive: true, createdAt: isoDaysAgo(400) },
  { id: 2, replitId: "demo-2", username: "sarah.manager", firstName: "Sarah", lastName: "Kim", email: "sarah.kim@rapport.dev", profileImage: null, role: "manager", roleId: null, teamId: null, managerId: null, targetAmount: null, isActive: true, createdAt: isoDaysAgo(380) },
  { id: 3, replitId: "demo-3", username: "marcus.bd", firstName: "Marcus", lastName: "Lee", email: "marcus.lee@rapport.dev", profileImage: null, role: "bd", roleId: null, teamId: null, managerId: 2, targetAmount: null, isActive: true, createdAt: isoDaysAgo(300) },
  { id: 4, replitId: "demo-4", username: "priya.bd", firstName: "Priya", lastName: "Anand", email: "priya.anand@rapport.dev", profileImage: null, role: "bd", roleId: null, teamId: null, managerId: 2, targetAmount: null, isActive: true, createdAt: isoDaysAgo(280) },
  { id: 5, replitId: "demo-5", username: "jordan.bd", firstName: "Jordan", lastName: "Reyes", email: "jordan.reyes@rapport.dev", profileImage: null, role: "bd", roleId: null, teamId: null, managerId: 2, targetAmount: null, isActive: true, createdAt: isoDaysAgo(250) },
];
nextId = 6;

const stages: Stage[] = [
  { id: id(), name: "New", color: "#64748b", order: 0, isDefault: true, isWon: false, isLost: false, type: "lead" },
  { id: id(), name: "Contacted", color: "#3b82f6", order: 1, isDefault: false, isWon: false, isLost: false, type: "lead" },
  { id: id(), name: "Qualified", color: "#8b5cf6", order: 2, isDefault: false, isWon: false, isLost: false, type: "lead" },
  { id: id(), name: "Proposal Sent", color: "#f59e0b", order: 3, isDefault: false, isWon: false, isLost: false, type: "lead" },
  { id: id(), name: "Negotiation", color: "#ec4899", order: 4, isDefault: false, isWon: false, isLost: false, type: "lead" },
  { id: id(), name: "Won", color: "#22c55e", order: 5, isDefault: false, isWon: true, isLost: false, type: "lead" },
  { id: id(), name: "Lost", color: "#ef4444", order: 6, isDefault: false, isWon: false, isLost: true, type: "lead" },
  { id: id(), name: "Discovery", color: "#3b82f6", order: 0, isDefault: true, isWon: false, isLost: false, type: "deal" },
  { id: id(), name: "Proposal", color: "#f59e0b", order: 1, isDefault: false, isWon: false, isLost: false, type: "deal" },
  { id: id(), name: "Negotiation", color: "#ec4899", order: 2, isDefault: false, isWon: false, isLost: false, type: "deal" },
  { id: id(), name: "Closed Won", color: "#22c55e", order: 3, isDefault: false, isWon: true, isLost: false, type: "deal" },
  { id: id(), name: "Closed Lost", color: "#ef4444", order: 4, isDefault: false, isWon: false, isLost: true, type: "deal" },
];
const leadStages = stages.filter((s) => s.type === "lead");
const dealStages = stages.filter((s) => s.type === "deal");

const tags: Tag[] = [
  { id: id(), name: "Enterprise", color: "#6366f1" },
  { id: id(), name: "SMB", color: "#06b6d4" },
  { id: id(), name: "Hot Lead", color: "#ef4444" },
  { id: id(), name: "Renewal", color: "#22c55e" },
  { id: id(), name: "Referral", color: "#f59e0b" },
  { id: id(), name: "Upsell", color: "#8b5cf6" },
];

const accounts: Account[] = COMPANIES.slice(0, 12).map((c, i) => {
  const owner = users[(i % 4) + 1];
  return {
    id: id(),
    name: c.name,
    industry: c.industry,
    website: `https://${c.name.toLowerCase().replace(/[^a-z]+/g, "")}.com`,
    size: rand(["1-10", "11-50", "51-200", "201-500", "500+"]),
    phone: `+1 555-01${String(i).padStart(2, "0")}`,
    location: c.location,
    notes: null,
    ownerId: owner.id,
    ownerName: `${owner.firstName} ${owner.lastName}`,
    createdById: owner.id,
    createdAt: isoDaysAgo(randInt(30, 300)),
    updatedAt: isoDaysAgo(randInt(0, 20)),
  };
});

const contacts: Contact[] = Array.from({ length: 16 }, (_, i) => {
  const account = accounts[i % accounts.length];
  const person = personName(i);
  const owner = users[(i % 4) + 1];
  return {
    id: id(),
    firstName: person.first,
    lastName: person.last,
    email: `${person.first.toLowerCase()}.${person.last.toLowerCase()}@${account.name.toLowerCase().replace(/[^a-z]+/g, "")}.com`,
    phone: `+1 555-02${String(i).padStart(2, "0")}`,
    title: TITLES[i % TITLES.length],
    accountId: account.id,
    accountName: account.name,
    ownerId: owner.id,
    ownerName: `${owner.firstName} ${owner.lastName}`,
    notes: null,
    createdById: owner.id,
    createdAt: isoDaysAgo(randInt(20, 280)),
    updatedAt: isoDaysAgo(randInt(0, 15)),
  };
});

const deals: Deal[] = Array.from({ length: 14 }, (_, i) => {
  const account = accounts[(i * 3) % accounts.length];
  const contact = contacts.find((c) => c.accountId === account.id) ?? contacts[i % contacts.length];
  const stage = dealStages[i % dealStages.length];
  const owner = users[(i % 4) + 1];
  const value = randInt(8, 180) * 1000;
  return {
    id: id(),
    name: `${account.name} — ${rand(["Platform", "Expansion", "Renewal", "Pilot", "Annual Contract"])}`,
    value: String(value),
    currency: "USD",
    stageId: stage.id,
    stageName: stage.name,
    stageColor: stage.color,
    closeDate: isoDaysFromNow(randInt(-20, 60)).slice(0, 10),
    probability: stage.isWon ? 100 : stage.isLost ? 0 : randInt(20, 80),
    accountId: account.id,
    accountName: account.name,
    contactId: contact?.id ?? null,
    contactName: contact ? `${contact.firstName} ${contact.lastName ?? ""}`.trim() : null,
    convertedFromLeadId: null,
    ownerId: owner.id,
    ownerName: `${owner.firstName} ${owner.lastName}`,
    notes: null,
    createdById: owner.id,
    createdAt: isoDaysAgo(randInt(5, 200)),
    updatedAt: isoDaysAgo(randInt(0, 10)),
  };
});

const leads: Lead[] = Array.from({ length: 24 }, (_, i) => {
  const company = COMPANIES[i % COMPANIES.length];
  const person = personName(i + 3);
  const stage = leadStages[i % leadStages.length];
  const owner = i % 5 === 0 ? null : users[(i % 4) + 1];
  const leadTags = i % 3 === 0 ? [tags[i % tags.length]] : i % 5 === 0 ? [tags[0], tags[2]] : [];
  return {
    id: id(),
    companyName: `${company.name}${i >= COMPANIES.length ? " II" : ""}`,
    contactPerson: person.full,
    email: `${person.first.toLowerCase()}.${person.last.toLowerCase()}@${company.name.toLowerCase().replace(/[^a-z]+/g, "")}.com`,
    phone: `+1 555-03${String(i).padStart(2, "0")}`,
    location: company.location,
    designation: TITLES[i % TITLES.length],
    industry: company.industry,
    linkedinUrl: `https://linkedin.com/in/${person.first.toLowerCase()}-${person.last.toLowerCase()}`,
    websiteUrl: `https://${company.name.toLowerCase().replace(/[^a-z]+/g, "")}.com`,
    remarks: null,
    comment: null,
    source: rand(["manual", "csv_import", "api", "web_form"]),
    priority: rand(["hot", "warm", "cold"]),
    channel: rand(["website", "whatsapp", "instagram", "email", "apollo", "referral", "linkedin", "database", "other"]),
    valueAmount: String(randInt(5, 120) * 1000),
    currency: "USD",
    expectedCloseDate: isoDaysFromNow(randInt(-10, 70)).slice(0, 10),
    nextFollowUpAt: stage.isWon || stage.isLost ? null : isoDaysFromNow(randInt(-3, 10)),
    tags: leadTags,
    stageId: stage.id,
    stageName: stage.name,
    stageColor: stage.color,
    ownerId: owner?.id ?? null,
    ownerName: owner ? `${owner.firstName} ${owner.lastName}` : null,
    createdById: owner?.id ?? DEMO_USER_ID,
    createdAt: isoDaysAgo(randInt(1, 180)),
    updatedAt: isoDaysAgo(randInt(0, 12)),
  };
});

const notesByLead = new Map<number, Note[]>();
const activitiesByLead = new Map<number, Activity[]>();
const followupsByLead = new Map<number, Followup[]>();
const tasksByLead = new Map<number, Task[]>();
const attachmentsByLead = new Map<number, Attachment[]>();
const dealNotes = new Map<number, CrmNote[]>();
const contactNotes = new Map<number, CrmNote[]>();
const revenueEntries = new Map<number, DealRevenueEntry[]>();
const auditLogs: AuditLog[] = [];
const allTasks: Task[] = [];
const scheduledActivities: ScheduledActivity[] = [];

function logActivity(leadId: number, type: string, description: string, oldValue: string | null = null, newValue: string | null = null, at = now()) {
  const list = activitiesByLead.get(leadId) ?? [];
  const actor = rand(users);
  list.push({ id: id(), leadId, type, description, oldValue, newValue, userId: actor.id, userName: `${actor.firstName} ${actor.lastName}`, userAvatar: null, createdAt: at });
  activitiesByLead.set(leadId, list);
}

function logAudit(leadId: number | null, leadName: string | null, action: string, at = now()) {
  const actor = rand(users);
  auditLogs.push({ id: id(), leadId, leadCompanyName: leadName, userId: actor.id, userName: `${actor.firstName} ${actor.lastName}`, action, tableName: "leads", fieldName: null, oldValue: null, newValue: null, ipAddress: null, createdAt: at });
}

// Seed notes/activities/followups/tasks for a third of the leads so detail
// pages (and dashboard/recent-activity/followups-due widgets) have content.
leads.forEach((lead, i) => {
  logActivity(lead.id, "created", `Lead created from ${lead.source.replace("_", " ")}.`, null, null, lead.createdAt);

  if (i % 3 === 0) {
    const noteAt = isoDaysAgo(randInt(0, 10));
    const author = rand(users);
    notesByLead.set(lead.id, [
      {
        id: id(), leadId: lead.id, content: `Had a great call with ${lead.contactPerson} — they're evaluating budget for ${rand(["Q2", "Q3", "next fiscal year"])}.`,
        type: "note", createdById: author.id, createdByName: `${author.firstName} ${author.lastName}`, createdByAvatar: null, createdAt: noteAt, updatedAt: noteAt,
      },
    ]);
    logActivity(lead.id, "note_added", "Note added.", null, null, noteAt);
  }

  if (i % 4 === 0) {
    const dueIn = [randInt(-2, -1), 0, randInt(1, 6)][i % 3];
    const scheduledAt = isoDaysFromNow(dueIn);
    followupsByLead.set(lead.id, [
      { id: id(), leadId: lead.id, scheduledAt, notes: "Follow up on proposal feedback.", status: "pending", createdById: DEMO_USER_ID, createdByName: "Demo Admin", createdAt: isoDaysAgo(5), updatedAt: isoDaysAgo(5) },
    ]);
    logActivity(lead.id, "followup_added", "Follow-up scheduled.", null, null, isoDaysAgo(5));
  }

  if (i % 5 === 0) {
    const task: Task = {
      id: id(), leadId: lead.id, leadCompanyName: lead.companyName, assignedToId: lead.ownerId, assignedToName: lead.ownerName,
      createdById: DEMO_USER_ID, createdByName: "Demo Admin", title: `Send ${rand(["pricing deck", "case study", "contract draft"])} to ${lead.contactPerson}`,
      description: null, dueDate: isoDaysFromNow(randInt(-1, 7)).slice(0, 10), status: rand(["todo", "in_progress", "done"]), priority: rand(["low", "medium", "high"]),
      createdAt: isoDaysAgo(randInt(1, 8)), updatedAt: isoDaysAgo(randInt(0, 3)),
    };
    tasksByLead.set(lead.id, [...(tasksByLead.get(lead.id) ?? []), task]);
    allTasks.push(task);
  }

  if (lead.stageName === "Won" || lead.stageName === "Lost") {
    logActivity(lead.id, "stage_changed", `Stage changed to ${lead.stageName}.`, "Negotiation", lead.stageName, isoDaysAgo(2));
    logAudit(lead.id, lead.companyName, `lead_stage_${lead.stageName.toLowerCase()}`, isoDaysAgo(2));
  }

  logAudit(lead.id, lead.companyName, "lead_created", lead.createdAt);
});

deals.forEach((deal, i) => {
  if (i % 3 === 0) {
    const author = rand(users);
    const noteAt = isoDaysAgo(randInt(0, 8));
    dealNotes.set(deal.id, [
      { id: id(), leadId: null, contactId: null, dealId: deal.id, type: "note", content: `${deal.contactName ?? "Contact"} asked for a custom rollout timeline.`, createdById: author.id, createdByName: `${author.firstName} ${author.lastName}`, createdByAvatar: null, createdAt: noteAt, updatedAt: noteAt },
    ]);
  }
  // A couple of months of recognized revenue for Closed Won deals, for the revenue chart.
  if (deal.stageName === "Closed Won") {
    const entries: DealRevenueEntry[] = [];
    for (let m = 2; m >= 0; m--) {
      const d = new Date();
      d.setMonth(d.getMonth() - m);
      entries.push({
        id: id(), dealId: deal.id, amount: String(Math.round(Number(deal.value) / 3)), month: monthKey(d),
        note: null, createdById: deal.ownerId, createdByName: deal.ownerName, workspaceId: null, createdAt: isoDaysAgo(m * 30), updatedAt: isoDaysAgo(m * 30),
      });
    }
    revenueEntries.set(deal.id, entries);
  }
});

contacts.forEach((contact, i) => {
  if (i % 4 === 0) {
    const author = rand(users);
    const noteAt = isoDaysAgo(randInt(0, 12));
    contactNotes.set(contact.id, [
      { id: id(), leadId: null, contactId: contact.id, dealId: null, type: "note", content: `Prefers email over calls; best reached in the afternoon.`, createdById: author.id, createdByName: `${author.firstName} ${author.lastName}`, createdByAvatar: null, createdAt: noteAt, updatedAt: noteAt },
    ]);
  }
});

// Scheduled activities for the My Day / calendar widgets.
for (let i = 0; i < 12; i++) {
  const lead = rand(leads);
  const owner = users[(i % 4) + 1];
  const dueAt = isoDaysFromNow(randInt(-2, 5));
  const status = new Date(dueAt) < new Date() ? rand(["completed", "overdue"]) : "open";
  scheduledActivities.push({
    id: id(), type: rand(["task", "call", "meeting", "followup"]), subject: `${rand(["Call", "Demo", "Check-in", "Proposal review"])} — ${lead.companyName}`,
    leadId: lead.id, leadCompanyName: lead.companyName, ownerId: owner.id, ownerName: `${owner.firstName} ${owner.lastName}`,
    dueAt, priority: rand(["low", "medium", "high"]), status, notes: null,
    completedAt: status === "completed" ? dueAt : null, createdById: owner.id, createdByName: `${owner.firstName} ${owner.lastName}`,
    createdAt: isoDaysAgo(randInt(1, 10)), updatedAt: isoDaysAgo(randInt(0, 5)),
  });
}

const notifications: Notification[] = [
  { id: id(), userId: DEMO_USER_ID, type: "followup_due", title: "Follow-up due today", body: `${leads[1].companyName} needs a check-in.`, read: false, leadId: leads[1].id, leadCompanyName: leads[1].companyName, taskId: null, followupId: null, createdAt: isoDaysAgo(0) },
  { id: id(), userId: DEMO_USER_ID, type: "lead_assigned", title: "New lead assigned to you", body: `${leads[2].companyName}`, read: false, leadId: leads[2].id, leadCompanyName: leads[2].companyName, taskId: null, followupId: null, createdAt: isoDaysAgo(1) },
  { id: id(), userId: DEMO_USER_ID, type: "task_due", title: "Task due soon", body: null, read: true, leadId: null, leadCompanyName: null, taskId: null, followupId: null, createdAt: isoDaysAgo(3) },
];

// ── Response helpers ─────────────────────────────────────────────────────────

function json(data: unknown, status = 200): Response {
  if (data === undefined || status === 204) return new Response(null, { status: 204 });
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}
function notFound(message = "Not found"): Response {
  return new Response(JSON.stringify({ error: message }), { status: 404, headers: { "content-type": "application/json" } });
}

function paginate<T>(items: T[], page = 1, limit = 20): { items: T[]; total: number; page: number; limit: number } {
  const start = (page - 1) * limit;
  return { items: items.slice(start, start + limit), total: items.length, page, limit };
}

function ownerName(ownerId: number | null): string | null {
  if (!ownerId) return null;
  const u = users.find((u) => u.id === ownerId);
  return u ? `${u.firstName} ${u.lastName}` : null;
}

// ── Dashboard / report aggregations (computed live from seed data) ─────────

function dashboardStats() {
  const wonStage = leadStages.find((s) => s.isWon)!;
  const lostStage = leadStages.find((s) => s.isLost)!;
  const won = leads.filter((l) => l.stageId === wonStage.id).length;
  const lost = leads.filter((l) => l.stageId === lostStage.id).length;
  const active = leads.length - won - lost;
  const newStage = leadStages[0];
  const closedValues = leads.filter((l) => l.stageId === wonStage.id).map((l) => Number(l.valueAmount ?? 0));
  return {
    totalLeads: leads.length,
    newLeads: leads.filter((l) => l.stageId === newStage.id).length,
    followupsDue: [...followupsByLead.values()].flat().filter((f) => f.status === "pending" && new Date(f.scheduledAt) <= new Date()).length,
    wonLeads: won,
    lostLeads: lost,
    conversionRate: leads.length ? Math.round((won / leads.length) * 1000) / 10 : 0,
    activeLeads: active,
    avgDealSize: closedValues.length ? closedValues.reduce((a, b) => a + b, 0) / closedValues.length : null,
  };
}

function pipelineData() {
  return leadStages.map((s) => ({ stageId: s.id, stageName: s.name, stageColor: s.color, count: leads.filter((l) => l.stageId === s.id).length }));
}

function conversionFunnel() {
  const total = leads.length || 1;
  const order = ["New", "Contacted", "Qualified", "Proposal Sent", "Negotiation", "Won"];
  let remaining = leads.length;
  return order.map((name, i) => {
    const stage = leadStages.find((s) => s.name === name)!;
    const atOrPast = leads.filter((l) => l.stageId >= stage.id && l.stageId <= leadStages[leadStages.length - 1].id && !(stage.name !== "Won" && (l.stageName === "Lost"))).length;
    const count = i === 0 ? leads.length : Math.max(0, Math.round(remaining * (0.55 + Math.random() * 0.15)));
    remaining = Math.min(remaining, count);
    return { stage: name, count, percentage: Math.round((count / total) * 1000) / 10 };
  });
}

function leaderboard() {
  return users.filter((u) => u.role !== "admin").map((u) => {
    const owned = leads.filter((l) => l.ownerId === u.id);
    const won = owned.filter((l) => l.stageName === "Won").length;
    const lost = owned.filter((l) => l.stageName === "Lost").length;
    return {
      userId: u.id, userName: `${u.firstName} ${u.lastName}`, userAvatar: null,
      totalLeads: owned.length, wonLeads: won, lostLeads: lost,
      activeLeads: owned.length - won - lost, conversionRate: owned.length ? Math.round((won / owned.length) * 1000) / 10 : 0,
    };
  }).sort((a, b) => b.wonLeads - a.wonLeads);
}

function dataHealth() {
  return {
    unassigned: leads.filter((l) => !l.ownerId).length,
    stale: leads.filter((l) => new Date(l.updatedAt) < new Date(isoDaysAgo(14))).length,
    missingEmail: leads.filter((l) => !l.email).length,
    missingValue: leads.filter((l) => !l.valueAmount).length,
    total: leads.length,
  };
}

function followupsDueSummary() {
  const all = [...followupsByLead.entries()].flatMap(([leadId, list]) =>
    list.filter((f) => f.status === "pending").map((f) => {
      const lead = leads.find((l) => l.id === leadId)!;
      return { id: f.id, leadId, leadCompanyName: lead.companyName, contactPerson: lead.contactPerson, scheduledAt: f.scheduledAt, notes: f.notes, status: f.status };
    })
  );
  const todayStr = now().slice(0, 10);
  const weekEnd = isoDaysFromNow(7);
  return {
    overdue: all.filter((f) => f.scheduledAt < now() && f.scheduledAt.slice(0, 10) !== todayStr).length,
    dueToday: all.filter((f) => f.scheduledAt.slice(0, 10) === todayStr).length,
    dueThisWeek: all.filter((f) => f.scheduledAt <= weekEnd).length,
    items: all,
  };
}

function myDayStats() {
  const todayStr = now().slice(0, 10);
  const todays = scheduledActivities.filter((a) => a.dueAt.slice(0, 10) === todayStr);
  const week = scheduledActivities.filter((a) => a.dueAt <= isoDaysFromNow(7));
  return {
    todayTotal: todays.length,
    todayCompleted: todays.filter((a) => a.status === "completed").length,
    todayOverdue: todays.filter((a) => a.status === "overdue").length,
    weekTotal: week.length,
    weekCompleted: week.filter((a) => a.status === "completed").length,
  };
}

function recentActivities(limit: number) {
  return [...activitiesByLead.entries()]
    .flatMap(([leadId, list]) => list.map((a) => ({ ...a, leadCompanyName: leads.find((l) => l.id === leadId)?.companyName ?? "" })))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, limit);
}

function dealsByStage() {
  return dealStages.map((s) => ({ stageId: s.id, stageName: s.name, stageColor: s.color, isWon: s.isWon, isLost: s.isLost, count: deals.filter((d) => d.stageId === s.id).length }));
}

function revenueOverTime() {
  const byMonth = new Map<string, number>();
  for (const entries of revenueEntries.values()) {
    for (const e of entries) byMonth.set(e.month, (byMonth.get(e.month) ?? 0) + Number(e.amount));
  }
  const months = [...byMonth.keys()].sort();
  let cumulative = 0;
  return months.map((month) => {
    const total = byMonth.get(month)!;
    cumulative += total;
    return { month, total, cumulative };
  });
}

function groupedBy<T>(items: T[], keyFn: (item: T) => string | null): { name: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = keyFn(item) ?? "Unknown";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
}

function monthlyGrowth(months: number) {
  const result = [];
  for (let m = months - 1; m >= 0; m--) {
    const d = new Date();
    d.setMonth(d.getMonth() - m);
    const key = monthKey(d);
    const created = leads.filter((l) => l.createdAt.slice(0, 7) === key).length;
    result.push({ month: d.toLocaleString("en-US", { month: "short" }), year: d.getFullYear(), created, won: Math.round(created * 0.3), lost: Math.round(created * 0.1) });
  }
  return result;
}

function userPerformance() {
  return leaderboard().map((l) => l);
}

// ── Router ───────────────────────────────────────────────────────────────────

function matchPath(pattern: string, pathname: string): Record<string, string> | null {
  const patternParts = pattern.split("/").filter(Boolean);
  const pathParts = pathname.split("/").filter(Boolean);
  if (patternParts.length !== pathParts.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < patternParts.length; i++) {
    const p = patternParts[i];
    if (p.startsWith(":")) params[p.slice(1)] = decodeURIComponent(pathParts[i]);
    else if (p !== pathParts[i]) return null;
  }
  return params;
}

async function route(method: string, pathname: string, search: URLSearchParams, body: unknown): Promise<Response> {
  const p = (pattern: string) => matchPath(pattern, pathname);
  const num = (s: string | undefined) => (s ? Number(s) : undefined);

  // Auth — always "logged in" as the demo admin.
  if (method === "GET" && pathname === "/api/auth/user") {
    const u = users[0];
    return json({
      user: {
        id: u.id, replitId: u.replitId, username: u.username, firstName: u.firstName, lastName: u.lastName,
        email: u.email, profileImage: u.profileImage, role: u.role, roleId: null, teamId: null, managerId: null,
        targetAmount: null, isAuthenticated: true, isSuperAdmin: false,
        permissions: ["dashboard.view", "leads.view", "contacts.view", "deals.view", "reports.view"],
      },
    });
  }
  if (method === "POST" && pathname === "/api/auth/logout") return json({ success: true });

  // Widgets — empty, so layout.tsx falls back to role-based nav visibility.
  if (method === "GET" && pathname === "/api/roles/my-widgets") return json({ widgets: [] });

  // Users
  if (method === "GET" && pathname === "/api/users") {
    let list = users;
    const role = search.get("role");
    if (role) list = list.filter((u) => u.role === role);
    return json(list);
  }

  // Stages
  if (method === "GET" && pathname === "/api/stages") {
    const type = search.get("type");
    return json(type ? stages.filter((s) => s.type === type) : stages);
  }

  // Tags
  if (method === "GET" && pathname === "/api/tags") return json(tags);

  // Notifications
  if (method === "GET" && pathname === "/api/notifications") {
    const mine = notifications.filter((n) => n.userId === DEMO_USER_ID);
    return json({ notifications: mine, unreadCount: mine.filter((n) => !n.read).length, dueCount: 1, comingDueCount: 2 });
  }
  if (method === "POST" && pathname === "/api/notifications/read-all") {
    notifications.forEach((n) => (n.read = true));
    return json({ success: true });
  }
  { const m = p("/api/notifications/:id/read"); if (method === "POST" && m) {
    const n = notifications.find((n) => n.id === Number(m.id));
    if (n) n.read = true;
    return json(n ?? { success: true });
  } }

  // Dashboard
  if (method === "GET" && pathname === "/api/dashboard/stats") return json(dashboardStats());
  if (method === "GET" && pathname === "/api/dashboard/pipeline") return json(pipelineData());
  if (method === "GET" && pathname === "/api/dashboard/conversion-funnel") return json(conversionFunnel());
  if (method === "GET" && pathname === "/api/dashboard/leaderboard") return json(leaderboard());
  if (method === "GET" && pathname === "/api/dashboard/data-health") return json(dataHealth());
  if (method === "GET" && pathname === "/api/dashboard/follow-ups-due") return json(followupsDueSummary());
  if (method === "GET" && pathname === "/api/dashboard/my-day") return json(myDayStats());
  if (method === "GET" && pathname === "/api/dashboard/deals-by-stage") return json(dealsByStage());
  if (method === "GET" && pathname === "/api/dashboard/revenue-over-time") return json(revenueOverTime());

  // Reports
  if (method === "GET" && pathname === "/api/reports/leads-by-status") return json(groupedBy(leads, (l) => l.stageName));
  if (method === "GET" && pathname === "/api/reports/leads-by-industry") return json(groupedBy(leads, (l) => l.industry));
  if (method === "GET" && pathname === "/api/reports/leads-by-location") return json(groupedBy(leads, (l) => l.location));
  if (method === "GET" && pathname === "/api/reports/monthly-growth") return json(monthlyGrowth(Number(search.get("months") ?? 12)));
  if (method === "GET" && pathname === "/api/reports/user-performance") return json(userPerformance());

  // Activities (recent, across all leads)
  if (method === "GET" && pathname === "/api/activities/recent") return json(recentActivities(Number(search.get("limit") ?? 20)));

  // Audit
  if (method === "GET" && pathname === "/api/audit") {
    let list = auditLogs;
    const leadId = num(search.get("leadId") ?? undefined);
    if (leadId) list = list.filter((a) => a.leadId === leadId);
    const page = Number(search.get("page") ?? 1);
    const limit = Number(search.get("limit") ?? 50);
    const { items, total } = paginate([...list].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)), page, limit);
    return json({ logs: items, total, page, limit });
  }

  // Leads
  if (method === "GET" && pathname === "/api/leads") {
    let list = leads;
    const stageId = num(search.get("stageId") ?? undefined);
    const ownerId = num(search.get("ownerId") ?? undefined);
    const industry = search.get("industry");
    const priority = search.get("priority");
    const channel = search.get("channel");
    const tagId = num(search.get("tagId") ?? undefined);
    const text = search.get("search");
    const status = search.get("status");
    if (stageId) list = list.filter((l) => l.stageId === stageId);
    if (ownerId) list = list.filter((l) => l.ownerId === ownerId);
    if (industry) list = list.filter((l) => l.industry === industry);
    if (priority) list = list.filter((l) => l.priority === priority);
    if (channel) list = list.filter((l) => l.channel === channel);
    if (tagId) list = list.filter((l) => l.tags.some((t) => t.id === tagId));
    if (text) { const t = text.toLowerCase(); list = list.filter((l) => l.companyName.toLowerCase().includes(t) || l.contactPerson.toLowerCase().includes(t)); }
    if (status === "won") list = list.filter((l) => l.stageName === "Won");
    else if (status === "lost") list = list.filter((l) => l.stageName === "Lost");
    else if (status === "open") list = list.filter((l) => l.stageName !== "Won" && l.stageName !== "Lost");
    const page = Number(search.get("page") ?? 1);
    const limit = Number(search.get("limit") ?? 20);
    const { items, total } = paginate(list, page, limit);
    return json({ leads: items, total, page, limit });
  }
  if (method === "POST" && pathname === "/api/leads") {
    const data = body as Record<string, unknown>;
    const stage = leadStages.find((s) => s.id === data.stageId) ?? leadStages[0];
    const lead: Lead = {
      id: id(), companyName: String(data.companyName ?? ""), contactPerson: String(data.contactPerson ?? ""),
      email: (data.email as string) ?? null, phone: (data.phone as string) ?? null, location: (data.location as string) ?? null,
      designation: (data.designation as string) ?? null, industry: (data.industry as string) ?? null,
      linkedinUrl: (data.linkedinUrl as string) ?? null, websiteUrl: (data.websiteUrl as string) ?? null,
      remarks: (data.remarks as string) ?? null, comment: (data.comment as string) ?? null, source: "manual",
      priority: (data.priority as string) ?? null, channel: (data.channel as string) ?? null,
      valueAmount: (data.valueAmount as string) ?? null, currency: "USD",
      expectedCloseDate: (data.expectedCloseDate as string) ?? null, nextFollowUpAt: (data.nextFollowUpAt as string) ?? null,
      tags: ((data.tagIds as number[]) ?? []).map((tid) => tags.find((t) => t.id === tid)).filter((t): t is Tag => !!t),
      stageId: stage.id, stageName: stage.name, stageColor: stage.color,
      ownerId: (data.ownerId as number) ?? DEMO_USER_ID, ownerName: ownerName((data.ownerId as number) ?? DEMO_USER_ID),
      createdById: DEMO_USER_ID, createdAt: now(), updatedAt: now(),
    };
    leads.unshift(lead);
    logActivity(lead.id, "created", "Lead created.");
    logAudit(lead.id, lead.companyName, "lead_created");
    return json(lead, 201);
  }
  if (method === "POST" && pathname === "/api/leads/bulk") {
    const data = body as { leadIds: number[]; action: string; stageId?: number; ownerId?: number };
    let affected = 0;
    for (const lead of leads) {
      if (!data.leadIds.includes(lead.id)) continue;
      if (data.action === "change_stage" && data.stageId) {
        const stage = leadStages.find((s) => s.id === data.stageId);
        if (stage) { lead.stageId = stage.id; lead.stageName = stage.name; lead.stageColor = stage.color; affected++; }
      } else if (data.action === "assign") {
        lead.ownerId = data.ownerId ?? null; lead.ownerName = ownerName(data.ownerId ?? null); affected++;
      } else if (data.action === "delete") {
        affected++;
      }
      lead.updatedAt = now();
    }
    if (data.action === "delete") {
      for (let i = leads.length - 1; i >= 0; i--) if (data.leadIds.includes(leads[i].id)) leads.splice(i, 1);
    }
    return json({ affected, message: `${affected} lead(s) updated.` });
  }
  { const m = p("/api/leads/:id"); if (m) {
    const leadId = Number(m.id);
    const lead = leads.find((l) => l.id === leadId);
    if (method === "GET") {
      if (!lead) return notFound("Lead not found");
      return json({
        ...lead,
        lostAt: lead.stageName === "Lost" ? lead.updatedAt : null,
        ownerAvatar: null, createdByName: ownerName(lead.createdById),
        notes: notesByLead.get(leadId) ?? [], followups: followupsByLead.get(leadId) ?? [], activities: activitiesByLead.get(leadId) ?? [],
      });
    }
    if (method === "PATCH") {
      if (!lead) return notFound("Lead not found");
      Object.assign(lead, body, { updatedAt: now() });
      if ((body as Record<string, unknown>).ownerId !== undefined) lead.ownerName = ownerName(lead.ownerId);
      logActivity(leadId, "updated", "Lead updated.");
      return json(lead);
    }
    if (method === "DELETE") {
      const idx = leads.findIndex((l) => l.id === leadId);
      if (idx !== -1) leads.splice(idx, 1);
      return json(undefined, 204);
    }
  } }
  { const m = p("/api/leads/:id/assign"); if (method === "PATCH" && m) {
    const lead = leads.find((l) => l.id === Number(m.id));
    if (!lead) return notFound("Lead not found");
    const data = body as { ownerId: number | null };
    lead.ownerId = data.ownerId; lead.ownerName = ownerName(data.ownerId); lead.updatedAt = now();
    logActivity(lead.id, "assigned", `Assigned to ${lead.ownerName ?? "nobody"}.`);
    return json(lead);
  } }
  { const m = p("/api/leads/:id/stage"); if (method === "PATCH" && m) {
    const lead = leads.find((l) => l.id === Number(m.id));
    if (!lead) return notFound("Lead not found");
    const data = body as { stageId: number };
    const stage = stages.find((s) => s.id === data.stageId);
    if (stage) {
      const old = lead.stageName;
      lead.stageId = stage.id; lead.stageName = stage.name; lead.stageColor = stage.color; lead.updatedAt = now();
      logActivity(lead.id, "stage_changed", `Stage changed to ${stage.name}.`, old, stage.name);
    }
    return json(lead);
  } }
  { const m = p("/api/leads/:id/convert"); if (method === "POST" && m) {
    const lead = leads.find((l) => l.id === Number(m.id));
    if (!lead) return notFound("Lead not found");
    const data = body as { contactFirstName?: string; contactLastName?: string; contactEmail?: string; accountName?: string; dealName?: string; dealValue?: string; createDeal?: boolean; createAccount?: boolean };
    let accountId: number | null = null;
    if (data.createAccount !== false) {
      const account: Account = { id: id(), name: data.accountName ?? lead.companyName, industry: lead.industry, website: lead.websiteUrl, size: null, phone: lead.phone, location: lead.location, notes: null, ownerId: lead.ownerId, ownerName: lead.ownerName, createdById: DEMO_USER_ID, createdAt: now(), updatedAt: now() };
      accounts.unshift(account);
      accountId = account.id;
    }
    const [first, ...rest] = lead.contactPerson.split(" ");
    const contact: Contact = { id: id(), firstName: data.contactFirstName ?? first, lastName: data.contactLastName ?? rest.join(" ") ?? null, email: data.contactEmail ?? lead.email, phone: lead.phone, title: lead.designation, accountId, accountName: data.accountName ?? lead.companyName, ownerId: lead.ownerId, ownerName: lead.ownerName, notes: null, createdById: DEMO_USER_ID, createdAt: now(), updatedAt: now() };
    contacts.unshift(contact);
    let dealId: number | null = null;
    if (data.createDeal !== false) {
      const stage = dealStages[0];
      const deal: Deal = { id: id(), name: data.dealName ?? `${lead.companyName} — New Business`, value: data.dealValue ?? lead.valueAmount, currency: "USD", stageId: stage.id, stageName: stage.name, stageColor: stage.color, closeDate: lead.expectedCloseDate, probability: 20, accountId, accountName: data.accountName ?? lead.companyName, contactId: contact.id, contactName: `${contact.firstName} ${contact.lastName ?? ""}`.trim(), convertedFromLeadId: lead.id, ownerId: lead.ownerId, ownerName: lead.ownerName, notes: null, createdById: DEMO_USER_ID, createdAt: now(), updatedAt: now() };
      deals.unshift(deal);
      dealId = deal.id;
    }
    const wonStage = leadStages.find((s) => s.isWon)!;
    lead.stageId = wonStage.id; lead.stageName = wonStage.name; lead.stageColor = wonStage.color; lead.updatedAt = now();
    logActivity(lead.id, "stage_changed", "Lead converted and marked Won.", lead.stageName, wonStage.name);
    return json({ contactId: contact.id, accountId, dealId, message: "Lead converted successfully." });
  } }

  // Lead notes
  { const m = p("/api/leads/:leadId/notes"); if (m) {
    const leadId = Number(m.leadId);
    if (method === "GET") return json(notesByLead.get(leadId) ?? []);
    if (method === "POST") {
      const data = body as { content: string };
      const note: Note = { id: id(), leadId, content: data.content, type: "note", createdById: DEMO_USER_ID, createdByName: "Demo Admin", createdByAvatar: null, createdAt: now(), updatedAt: now() };
      notesByLead.set(leadId, [note, ...(notesByLead.get(leadId) ?? [])]);
      logActivity(leadId, "note_added", "Note added.");
      return json(note, 201);
    }
  } }
  { const m = p("/api/notes/:id"); if (m) {
    let found: Note | undefined;
    for (const list of notesByLead.values()) { const n = list.find((n) => n.id === Number(m.id)); if (n) { found = n; break; } }
    if (!found) return notFound("Note not found");
    if (method === "PATCH") { Object.assign(found, body, { updatedAt: now() }); return json(found); }
    if (method === "DELETE") {
      for (const [leadId, list] of notesByLead.entries()) notesByLead.set(leadId, list.filter((n) => n.id !== found!.id));
      return json(undefined, 204);
    }
  } }

  // Lead followups
  { const m = p("/api/leads/:leadId/followups"); if (m) {
    const leadId = Number(m.leadId);
    if (method === "GET") return json(followupsByLead.get(leadId) ?? []);
    if (method === "POST") {
      const data = body as { scheduledAt: string; notes?: string };
      const f: Followup = { id: id(), leadId, scheduledAt: data.scheduledAt, notes: data.notes ?? null, status: "pending", createdById: DEMO_USER_ID, createdByName: "Demo Admin", createdAt: now(), updatedAt: now() };
      followupsByLead.set(leadId, [f, ...(followupsByLead.get(leadId) ?? [])]);
      logActivity(leadId, "followup_added", "Follow-up scheduled.");
      return json(f, 201);
    }
  } }
  { const m = p("/api/followups/:id"); if (m) {
    let found: Followup | undefined;
    for (const list of followupsByLead.values()) { const f = list.find((f) => f.id === Number(m.id)); if (f) { found = f; break; } }
    if (!found) return notFound("Follow-up not found");
    if (method === "PATCH") { Object.assign(found, body, { updatedAt: now() }); return json(found); }
    if (method === "DELETE") {
      for (const [leadId, list] of followupsByLead.entries()) followupsByLead.set(leadId, list.filter((f) => f.id !== found!.id));
      return json(undefined, 204);
    }
  } }
  if (method === "GET" && pathname === "/api/followups/due") {
    return json(followupsDueSummary().items.map((i) => ({ ...i, leadCompanyName: i.leadCompanyName })));
  }

  // Lead activities
  { const m = p("/api/leads/:leadId/activities"); if (method === "GET" && m) return json(activitiesByLead.get(Number(m.leadId)) ?? []); }

  // Lead attachments
  { const m = p("/api/leads/:leadId/attachments"); if (m) {
    const leadId = Number(m.leadId);
    if (method === "GET") return json(attachmentsByLead.get(leadId) ?? []);
    if (method === "POST") {
      const data = body as { fileName: string; fileSize?: number; mimeType?: string };
      const a: Attachment = { id: id(), leadId, fileName: data.fileName, fileSize: data.fileSize ?? null, mimeType: data.mimeType ?? null, uploadedById: DEMO_USER_ID, uploadedByName: "Demo Admin", createdAt: now() };
      attachmentsByLead.set(leadId, [a, ...(attachmentsByLead.get(leadId) ?? [])]);
      return json(a, 201);
    }
  } }
  { const m = p("/api/attachments/:id"); if (method === "DELETE" && m) {
    for (const [leadId, list] of attachmentsByLead.entries()) attachmentsByLead.set(leadId, list.filter((a) => a.id !== Number(m.id)));
    return json(undefined, 204);
  } }

  // Lead tasks + global tasks
  { const m = p("/api/leads/:leadId/tasks"); if (m) {
    const leadId = Number(m.leadId);
    if (method === "GET") return json(tasksByLead.get(leadId) ?? []);
    if (method === "POST") {
      const data = body as { title: string; description?: string; dueDate?: string; status?: string; priority?: string; assignedToId?: number };
      const lead = leads.find((l) => l.id === leadId);
      const t: Task = { id: id(), leadId, leadCompanyName: lead?.companyName ?? null, assignedToId: data.assignedToId ?? null, assignedToName: ownerName(data.assignedToId ?? null), createdById: DEMO_USER_ID, createdByName: "Demo Admin", title: data.title, description: data.description ?? null, dueDate: data.dueDate ?? null, status: data.status ?? "todo", priority: data.priority ?? "medium", createdAt: now(), updatedAt: now() };
      tasksByLead.set(leadId, [t, ...(tasksByLead.get(leadId) ?? [])]);
      allTasks.unshift(t);
      logActivity(leadId, "task_added", `Task added: ${t.title}`);
      return json(t, 201);
    }
  } }
  if (method === "GET" && pathname === "/api/tasks") {
    let list = allTasks;
    const status = search.get("status");
    const assignedToId = num(search.get("assignedToId") ?? undefined);
    if (status) list = list.filter((t) => t.status === status);
    if (assignedToId) list = list.filter((t) => t.assignedToId === assignedToId);
    const page = Number(search.get("page") ?? 1);
    const limit = Number(search.get("limit") ?? 20);
    const { items, total } = paginate(list, page, limit);
    return json({ tasks: items, total, page, limit });
  }
  { const m = p("/api/tasks/:id"); if (m) {
    const t = allTasks.find((t) => t.id === Number(m.id));
    if (!t) return notFound("Task not found");
    if (method === "PATCH") {
      Object.assign(t, body, { updatedAt: now() });
      if (t.leadId) logActivity(t.leadId, "task_updated", `Task updated: ${t.title}`);
      return json(t);
    }
    if (method === "DELETE") {
      const idx = allTasks.findIndex((x) => x.id === t.id);
      if (idx !== -1) allTasks.splice(idx, 1);
      if (t.leadId) { const list = tasksByLead.get(t.leadId) ?? []; tasksByLead.set(t.leadId, list.filter((x) => x.id !== t.id)); }
      return json(undefined, 204);
    }
  } }

  // Scheduled activities
  if (method === "GET" && pathname === "/api/scheduled-activities") {
    let list = scheduledActivities;
    const ownerId = num(search.get("ownerId") ?? undefined);
    const type = search.get("type");
    const status = search.get("status");
    const leadId = num(search.get("leadId") ?? undefined);
    if (ownerId) list = list.filter((a) => a.ownerId === ownerId);
    if (type) list = list.filter((a) => a.type === type);
    if (status) list = list.filter((a) => a.status === status);
    if (leadId) list = list.filter((a) => a.leadId === leadId);
    return json({ activities: list, total: list.length });
  }
  if (method === "POST" && pathname === "/api/scheduled-activities") {
    const data = body as { type: string; subject: string; leadId?: number; ownerId?: number; dueAt: string; priority?: string; notes?: string };
    const lead = data.leadId ? leads.find((l) => l.id === data.leadId) : undefined;
    const a: ScheduledActivity = { id: id(), type: data.type, subject: data.subject, leadId: data.leadId ?? null, leadCompanyName: lead?.companyName ?? null, ownerId: data.ownerId ?? DEMO_USER_ID, ownerName: ownerName(data.ownerId ?? DEMO_USER_ID), dueAt: data.dueAt, priority: data.priority ?? "medium", status: "open", notes: data.notes ?? null, completedAt: null, createdById: DEMO_USER_ID, createdByName: "Demo Admin", createdAt: now(), updatedAt: now() };
    scheduledActivities.unshift(a);
    return json(a, 201);
  }
  { const m = p("/api/scheduled-activities/:id/complete"); if (method === "PATCH" && m) {
    const a = scheduledActivities.find((a) => a.id === Number(m.id));
    if (!a) return notFound("Activity not found");
    a.status = "completed"; a.completedAt = now(); a.updatedAt = now();
    return json(a);
  } }
  { const m = p("/api/scheduled-activities/:id"); if (m) {
    const a = scheduledActivities.find((a) => a.id === Number(m.id));
    if (!a) return notFound("Activity not found");
    if (method === "PATCH") { Object.assign(a, body, { updatedAt: now() }); return json(a); }
    if (method === "DELETE") {
      const idx = scheduledActivities.findIndex((x) => x.id === a.id);
      if (idx !== -1) scheduledActivities.splice(idx, 1);
      return json(undefined, 204);
    }
  } }

  // Accounts
  if (method === "GET" && pathname === "/api/accounts") {
    let list = accounts;
    const text = search.get("search");
    if (text) { const t = text.toLowerCase(); list = list.filter((a) => a.name.toLowerCase().includes(t)); }
    const page = Number(search.get("page") ?? 1);
    const limit = Number(search.get("limit") ?? 20);
    const { items, total } = paginate(list, page, limit);
    return json({ accounts: items, total, page, limit });
  }
  if (method === "POST" && pathname === "/api/accounts") {
    const data = body as Record<string, unknown>;
    const a: Account = { id: id(), name: String(data.name ?? ""), industry: (data.industry as string) ?? null, website: (data.website as string) ?? null, size: (data.size as string) ?? null, phone: (data.phone as string) ?? null, location: (data.location as string) ?? null, notes: (data.notes as string) ?? null, ownerId: (data.ownerId as number) ?? DEMO_USER_ID, ownerName: ownerName((data.ownerId as number) ?? DEMO_USER_ID), createdById: DEMO_USER_ID, createdAt: now(), updatedAt: now() };
    accounts.unshift(a);
    return json(a, 201);
  }
  { const m = p("/api/accounts/:id"); if (m) {
    const a = accounts.find((a) => a.id === Number(m.id));
    if (!a) return notFound("Account not found");
    if (method === "PATCH") { Object.assign(a, body, { updatedAt: now() }); if ((body as Record<string, unknown>).ownerId !== undefined) a.ownerName = ownerName(a.ownerId); return json(a); }
    if (method === "DELETE") { const idx = accounts.findIndex((x) => x.id === a.id); if (idx !== -1) accounts.splice(idx, 1); return json(undefined, 204); }
  } }

  // Contacts
  if (method === "GET" && pathname === "/api/contacts") {
    let list = contacts;
    const text = search.get("search");
    const accountId = num(search.get("accountId") ?? undefined);
    if (text) { const t = text.toLowerCase(); list = list.filter((c) => `${c.firstName} ${c.lastName ?? ""}`.toLowerCase().includes(t)); }
    if (accountId) list = list.filter((c) => c.accountId === accountId);
    const page = Number(search.get("page") ?? 1);
    const limit = Number(search.get("limit") ?? 20);
    const { items, total } = paginate(list, page, limit);
    return json({ contacts: items, total, page, limit });
  }
  if (method === "POST" && pathname === "/api/contacts") {
    const data = body as Record<string, unknown>;
    const account = data.accountId ? accounts.find((a) => a.id === data.accountId) : undefined;
    const c: Contact = { id: id(), firstName: String(data.firstName ?? ""), lastName: (data.lastName as string) ?? null, email: (data.email as string) ?? null, phone: (data.phone as string) ?? null, title: (data.title as string) ?? null, accountId: account?.id ?? null, accountName: account?.name ?? null, ownerId: (data.ownerId as number) ?? DEMO_USER_ID, ownerName: ownerName((data.ownerId as number) ?? DEMO_USER_ID), notes: (data.notes as string) ?? null, createdById: DEMO_USER_ID, createdAt: now(), updatedAt: now() };
    contacts.unshift(c);
    return json(c, 201);
  }
  { const m = p("/api/contacts/:id"); if (m) {
    const c = contacts.find((c) => c.id === Number(m.id));
    if (method === "GET") return c ? json(c) : notFound("Contact not found");
    if (!c) return notFound("Contact not found");
    if (method === "PATCH") { Object.assign(c, body, { updatedAt: now() }); if ((body as Record<string, unknown>).ownerId !== undefined) c.ownerName = ownerName(c.ownerId); return json(c); }
    if (method === "DELETE") { const idx = contacts.findIndex((x) => x.id === c.id); if (idx !== -1) contacts.splice(idx, 1); return json(undefined, 204); }
  } }
  { const m = p("/api/contacts/:contactId/notes"); if (m) {
    const contactId = Number(m.contactId);
    if (method === "GET") return json(contactNotes.get(contactId) ?? []);
    if (method === "POST") {
      const data = body as { content: string; type?: string };
      const n: CrmNote = { id: id(), leadId: null, contactId, dealId: null, type: data.type ?? "note", content: data.content, createdById: DEMO_USER_ID, createdByName: "Demo Admin", createdByAvatar: null, createdAt: now(), updatedAt: now() };
      contactNotes.set(contactId, [n, ...(contactNotes.get(contactId) ?? [])]);
      return json(n, 201);
    }
  } }

  // Deals
  if (method === "GET" && pathname === "/api/deals") {
    let list = deals;
    const text = search.get("search");
    const stageId = num(search.get("stageId") ?? undefined);
    const ownerId = num(search.get("ownerId") ?? undefined);
    const accountId = num(search.get("accountId") ?? undefined);
    if (text) { const t = text.toLowerCase(); list = list.filter((d) => d.name.toLowerCase().includes(t)); }
    if (stageId) list = list.filter((d) => d.stageId === stageId);
    if (ownerId) list = list.filter((d) => d.ownerId === ownerId);
    if (accountId) list = list.filter((d) => d.accountId === accountId);
    const page = Number(search.get("page") ?? 1);
    const limit = Number(search.get("limit") ?? 20);
    const { items, total } = paginate(list, page, limit);
    return json({ deals: items, total, page, limit });
  }
  if (method === "POST" && pathname === "/api/deals") {
    const data = body as Record<string, unknown>;
    const stage = dealStages.find((s) => s.id === data.stageId) ?? dealStages[0];
    const account = data.accountId ? accounts.find((a) => a.id === data.accountId) : undefined;
    const contact = data.contactId ? contacts.find((c) => c.id === data.contactId) : undefined;
    const d: Deal = { id: id(), name: String(data.name ?? ""), value: (data.value as string) ?? null, currency: (data.currency as string) ?? "USD", stageId: stage.id, stageName: stage.name, stageColor: stage.color, closeDate: (data.closeDate as string) ?? null, probability: (data.probability as number) ?? null, accountId: account?.id ?? null, accountName: account?.name ?? null, contactId: contact?.id ?? null, contactName: contact ? `${contact.firstName} ${contact.lastName ?? ""}`.trim() : null, convertedFromLeadId: null, ownerId: (data.ownerId as number) ?? DEMO_USER_ID, ownerName: ownerName((data.ownerId as number) ?? DEMO_USER_ID), notes: (data.notes as string) ?? null, createdById: DEMO_USER_ID, createdAt: now(), updatedAt: now() };
    deals.unshift(d);
    return json(d, 201);
  }
  { const m = p("/api/deals/:id/stage"); if (method === "PATCH" && m) {
    const d = deals.find((d) => d.id === Number(m.id));
    if (!d) return notFound("Deal not found");
    const data = body as { stageId: number };
    const stage = dealStages.find((s) => s.id === data.stageId);
    if (stage) { d.stageId = stage.id; d.stageName = stage.name; d.stageColor = stage.color; d.updatedAt = now(); }
    return json(d);
  } }
  { const m = p("/api/deals/:id"); if (m) {
    const d = deals.find((d) => d.id === Number(m.id));
    if (method === "GET") return d ? json(d) : notFound("Deal not found");
    if (!d) return notFound("Deal not found");
    if (method === "PATCH") { Object.assign(d, body, { updatedAt: now() }); if ((body as Record<string, unknown>).ownerId !== undefined) d.ownerName = ownerName(d.ownerId); return json(d); }
    if (method === "DELETE") { const idx = deals.findIndex((x) => x.id === d.id); if (idx !== -1) deals.splice(idx, 1); return json(undefined, 204); }
  } }
  { const m = p("/api/deals/:dealId/notes"); if (m) {
    const dealId = Number(m.dealId);
    if (method === "GET") return json(dealNotes.get(dealId) ?? []);
    if (method === "POST") {
      const data = body as { content: string; type?: string };
      const n: CrmNote = { id: id(), leadId: null, contactId: null, dealId, type: data.type ?? "note", content: data.content, createdById: DEMO_USER_ID, createdByName: "Demo Admin", createdByAvatar: null, createdAt: now(), updatedAt: now() };
      dealNotes.set(dealId, [n, ...(dealNotes.get(dealId) ?? [])]);
      return json(n, 201);
    }
  } }
  { const m = p("/api/deals/:dealId/revenue-entries"); if (m) {
    const dealId = Number(m.dealId);
    if (method === "GET") return json(revenueEntries.get(dealId) ?? []);
    if (method === "POST") {
      const data = body as { amount: string; month: string; note?: string };
      const e: DealRevenueEntry = { id: id(), dealId, amount: data.amount, month: data.month, note: data.note ?? null, createdById: DEMO_USER_ID, createdByName: "Demo Admin", workspaceId: null, createdAt: now(), updatedAt: now() };
      revenueEntries.set(dealId, [e, ...(revenueEntries.get(dealId) ?? [])]);
      return json(e, 201);
    }
  } }
  { const m = p("/api/deals/:dealId/revenue-entries/:entryId"); if (m) {
    const dealId = Number(m.dealId);
    const list = revenueEntries.get(dealId) ?? [];
    const e = list.find((e) => e.id === Number(m.entryId));
    if (!e) return notFound("Revenue entry not found");
    if (method === "PATCH") { Object.assign(e, body, { updatedAt: now() }); return json(e); }
    if (method === "DELETE") { revenueEntries.set(dealId, list.filter((x) => x.id !== e.id)); return json(undefined, 204); }
  } }

  // Anything else under /api — don't break the shell, just say "not in this demo".
  if (pathname.startsWith("/api/")) {
    return notFound("This page isn't included in the demo tour.");
  }

  return notFound();
}

function resolveRequestInfo(input: RequestInfo | URL, init?: RequestInit): { method: string; pathname: string; search: URLSearchParams; body: unknown } {
  const isRequestObj = typeof Request !== "undefined" && input instanceof Request;
  const urlStr = typeof input === "string" ? input : isRequestObj ? (input as Request).url : (input as URL).toString();
  const method = (init?.method ?? (isRequestObj ? (input as Request).method : "GET")).toUpperCase();
  const url = new URL(urlStr, location.origin);
  let body: unknown;
  const rawBody = init?.body;
  if (typeof rawBody === "string") {
    try { body = JSON.parse(rawBody); } catch { body = rawBody; }
  }
  return { method, pathname: url.pathname, search: url.searchParams, body };
}

export function installDemoFetch(): void {
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const { method, pathname, search, body } = resolveRequestInfo(input, init);
    if (!pathname.startsWith("/api/")) return realFetch(input, init);
    await new Promise((r) => setTimeout(r, 150 + Math.random() * 200));
    try {
      return await route(method, pathname, search, body);
    } catch (err) {
      console.error("[demo] mock route threw", method, pathname, err);
      return new Response(JSON.stringify({ error: "Demo data error" }), { status: 500, headers: { "content-type": "application/json" } });
    }
  };
}
