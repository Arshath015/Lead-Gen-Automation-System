import { Router, type IRouter, type Request, type Response } from "express";
import {
  db, stagesTable, leadsTable, tagsTable, leadTagsTable,
  notesTable, followupsTable, tasksTable, activitiesTable,
} from "@workspace/db";
import { eq, count } from "drizzle-orm";

const router: IRouter = Router();

router.post("/admin/seed-demo", async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (req.user.role !== "admin") { res.status(403).json({ error: "Admin only" }); return; }

  const [{ value: leadCount }] = await db.select({ value: count() }).from(leadsTable);
  if (Number(leadCount) >= 10) {
    res.json({ message: "Demo data already loaded", skipped: true });
    return;
  }

  const stages = await db.select().from(stagesTable).orderBy(stagesTable.order);
  if (stages.length === 0) {
    res.status(400).json({ error: "No pipeline stages found. Please set up stages first." });
    return;
  }

  const stageByName = (name: string) => stages.find(s => s.name === name)?.id ?? stages[0].id;
  const actorId = req.user.id;

  // Tags
  const tagDefs = [
    { name: "Hot Lead",   color: "#ef4444" },
    { name: "VIP",        color: "#f59e0b" },
    { name: "Enterprise", color: "#6366f1" },
    { name: "Startup",    color: "#10b981" },
    { name: "Inbound",    color: "#3b82f6" },
  ];
  const insertedTags: Array<{ id: number; name: string }> = [];
  for (const td of tagDefs) {
    const existing = await db.select().from(tagsTable).where(eq(tagsTable.name, td.name));
    if (existing.length > 0) {
      insertedTags.push({ id: existing[0].id, name: td.name });
    } else {
      const [t] = await db.insert(tagsTable).values(td).returning();
      insertedTags.push({ id: t.id, name: t.name });
    }
  }
  const tagId = (name: string) => insertedTags.find(t => t.name === name)?.id;

  // Helper: create lead + activity
  async function mkLead(data: {
    companyName: string; contactPerson: string; designation?: string;
    email?: string; phone?: string; location?: string; industry?: string;
    linkedinUrl?: string; websiteUrl?: string; remarks?: string;
    stageName: string; priority?: "hot" | "warm" | "cold";
    channel?: "website" | "whatsapp" | "instagram" | "email" | "apollo" | "referral" | "linkedin" | "database" | "other";
    tags?: string[];
  }) {
    const stageId = stageByName(data.stageName);
    const [lead] = await db.insert(leadsTable).values({
      companyName: data.companyName,
      contactPerson: data.contactPerson,
      designation: data.designation,
      email: data.email,
      phone: data.phone,
      location: data.location,
      industry: data.industry,
      linkedinUrl: data.linkedinUrl,
      websiteUrl: data.websiteUrl,
      remarks: data.remarks,
      stageId,
      priority: data.priority ?? "warm",
      channel: data.channel ?? "other",
      source: "manual",
      createdById: actorId,
      ownerId: actorId,
    }).returning();
    await db.insert(activitiesTable).values({
      leadId: lead.id, type: "created",
      description: "created this lead", userId: actorId,
    });
    for (const tname of data.tags ?? []) {
      const tid = tagId(tname);
      if (tid) await db.insert(leadTagsTable).values({ leadId: lead.id, tagId: tid });
    }
    return lead;
  }

  // 18 sample leads
  const l1  = await mkLead({ companyName: "Nexus Cloud Ltd",         contactPerson: "Arjun Sharma",      designation: "CTO",                email: "arjun@nexuscloud.io",          phone: "+91 98765 43210",  location: "Bangalore",    industry: "SaaS",                     linkedinUrl: "https://linkedin.com/in/arjunsharma", websiteUrl: "https://nexuscloud.io",    remarks: "High growth SaaS startup, evaluating enterprise plans. Budget approved.", stageName: "Negotiation",    priority: "hot",  channel: "apollo",    tags: ["Hot Lead", "Startup"] });
  const l2  = await mkLead({ companyName: "GlobalTech Solutions",    contactPerson: "Sarah Mitchell",    designation: "VP of Engineering",  email: "sarah.mitchell@globaltech.com", phone: "+1 415 555 0192",  location: "San Francisco", industry: "Technology",               websiteUrl: "https://globaltech.com",                                              remarks: "Fortune 500 client. Long sales cycle expected.",                         stageName: "Qualified",      priority: "hot",  channel: "referral",  tags: ["Enterprise", "VIP"] });
  const l3  = await mkLead({ companyName: "FinEdge Analytics",       contactPerson: "Priya Nair",         designation: "CEO",               email: "priya@finedge.in",              phone: "+91 80001 23456",  location: "Mumbai",       industry: "FinTech",                  websiteUrl: "https://finedge.in",                                                                                                                                     stageName: "Proposal Sent",  priority: "hot",  channel: "website",   tags: ["Hot Lead", "Startup"] });
  const l4  = await mkLead({ companyName: "BlueOcean Media",         contactPerson: "James Carter",      designation: "Marketing Director", email: "james@blueocean.media",         phone: "+44 20 7946 0958", location: "London",       industry: "Media & Advertising",                                                                                                                                      stageName: "Contacted",      priority: "warm", channel: "instagram", tags: ["Inbound"] });
  const l5  = await mkLead({ companyName: "Zenith Manufacturing",    contactPerson: "Wei Zhang",         designation: "Operations Head",    email: "wei.zhang@zenithmfg.com",       phone: "+86 10 8234 5678", location: "Shanghai",     industry: "Manufacturing",                                                                                                                                            stageName: "Won",            priority: "warm", channel: "apollo",    tags: ["Enterprise"] });
  const l6  = await mkLead({ companyName: "AgriData Systems",        contactPerson: "Raj Patel",         designation: "Co-Founder",         email: "raj@agridata.io",               phone: "+91 99001 88776",  location: "Pune",         industry: "AgriTech",                                                                                                                                                 stageName: "New Lead",       priority: "warm", channel: "referral",  tags: ["Startup", "Inbound"] });
  const l7  = await mkLead({ companyName: "Vortex Retail Group",     contactPerson: "Emma Thompson",     designation: "Head of Digital",    email: "emma.t@vortexretail.com",       phone: "+61 2 8765 4321",  location: "Sydney",       industry: "Retail & E-Commerce",                                                                                                                                      stageName: "Lost",           priority: "cold", channel: "email",     remarks: "Budget freeze Q4. Revisit in Q2 next year." });
  const l8  = await mkLead({ companyName: "Clarity Health Tech",     contactPerson: "Dr. Neha Joshi",    designation: "CTO",                email: "neha@clarityhealth.com",        phone: "+91 77001 55432",  location: "Hyderabad",    industry: "HealthTech",               linkedinUrl: "https://linkedin.com/in/drnehajoshi",                                remarks: "Referred by board member. Wants dedicated support Slack.",               stageName: "Negotiation",    priority: "hot",  channel: "referral",  tags: ["Hot Lead", "VIP", "Startup"] });
  const l9  = await mkLead({ companyName: "PolarStar Logistics",     contactPerson: "Anders Eriksson",   designation: "CEO",                email: "anders@polarstar.se",           phone: "+46 8 5555 1234",  location: "Stockholm",    industry: "Logistics & Supply Chain",                                                                                                                                 stageName: "Qualified",      priority: "hot",  channel: "website",   tags: ["Enterprise"] });
  const l10 = await mkLead({ companyName: "Momentum Studios",        contactPerson: "Rohan Desai",       designation: "Creative Director",  email: "rohan@momentumstudios.in",      phone: "+91 95001 77654",  location: "Delhi",        industry: "Creative & Design",                                                                                                                                        stageName: "New Lead",       priority: "cold", channel: "instagram", tags: ["Inbound"] });
  const l11 = await mkLead({ companyName: "Fortress Cybersecurity",  contactPerson: "Marcus Johnson",    designation: "CISO",               email: "marcus.j@fortress.io",          phone: "+1 628 555 0113",  location: "Austin",       industry: "Cybersecurity",            websiteUrl: "https://fortress.io",                                                                                                                                    stageName: "Contacted",      priority: "hot",  channel: "apollo",    tags: ["Enterprise", "Hot Lead"] });
  const l12 = await mkLead({ companyName: "EduSpark Learning",       contactPerson: "Ananya Krishnan",   designation: "Product Head",       email: "ananya@eduspark.com",           phone: "+91 88002 44321",  location: "Chennai",      industry: "EdTech",                                                                                                                                                   stageName: "Proposal Sent",  priority: "warm", channel: "website",   tags: ["Startup"] });
  const l13 = await mkLead({ companyName: "Olympus Real Estate",     contactPerson: "Carlos Mendez",     designation: "Managing Partner",   email: "carlos.m@olympusrealty.com",    phone: "+52 55 5555 0198", location: "Mexico City",  industry: "Real Estate",                                                                                                                                              stageName: "Contacted",      priority: "warm", channel: "referral" });
  const l14 = await mkLead({ companyName: "TrueNorth Capital",       contactPerson: "Sophia Bergmann",   designation: "Managing Director",  email: "sophia.b@truenorth.ca",         phone: "+1 416 555 0174",  location: "Toronto",      industry: "Finance & Investment",                                                                                                                                     stageName: "Won",            priority: "hot",  channel: "referral",  tags: ["VIP", "Enterprise"] });
  const l15 = await mkLead({ companyName: "DataPulse AI",            contactPerson: "Kevin O'Brien",     designation: "CEO",                email: "kevin@datapulse.ai",            phone: "+1 737 555 0182",  location: "Dallas",       industry: "Artificial Intelligence",  linkedinUrl: "https://linkedin.com/in/kevinobrien", websiteUrl: "https://datapulse.ai",     remarks: "Series A funded. Wants custom AI integration. Moving fast.",            stageName: "Qualified",      priority: "hot",  channel: "apollo",    tags: ["Hot Lead", "Startup"] });
  const l16 = await mkLead({ companyName: "Heritage Hospitality",    contactPerson: "Aisha Al-Rashid",   designation: "Operations Director",email: "aisha@heritagehospitality.ae",  phone: "+971 4 555 0167",  location: "Dubai",        industry: "Hospitality & Tourism",                                                                                                                                    stageName: "New Lead",       priority: "warm", channel: "whatsapp" });
  const l17 = await mkLead({ companyName: "PixelForge Games",        contactPerson: "Tanaka Hiroshi",    designation: "Studio Head",        email: "hiroshi@pixelforge.jp",         phone: "+81 3 5555 1234",  location: "Tokyo",        industry: "Gaming & Entertainment",                                                                                                                                   stageName: "Lost",           priority: "cold", channel: "website",   remarks: "Went with a competitor. Pricing was the blocker." });
  const l18 = await mkLead({ companyName: "BioSynth Research",       contactPerson: "Dr. Laura Romero",  designation: "R&D Director",       email: "laura.r@biosynth.eu",           phone: "+34 91 555 0134",  location: "Madrid",       industry: "Biotechnology",                                                                                                                                            stageName: "Proposal Sent",  priority: "hot",  channel: "referral",  tags: ["Enterprise", "VIP"] });

  // Stage change activities for won/lost leads
  await db.insert(activitiesTable).values([
    { leadId: l5.id,  type: "stage_changed", description: "moved to Won",  oldValue: "Negotiation",   newValue: "Won",  userId: actorId },
    { leadId: l14.id, type: "stage_changed", description: "moved to Won",  oldValue: "Proposal Sent", newValue: "Won",  userId: actorId },
    { leadId: l7.id,  type: "stage_changed", description: "moved to Lost", oldValue: "Contacted",     newValue: "Lost", userId: actorId },
    { leadId: l17.id, type: "stage_changed", description: "moved to Lost", oldValue: "Contacted",     newValue: "Lost", userId: actorId },
  ]);

  // Notes
  const noteData: Array<{ leadId: number; content: string }> = [
    { leadId: l1.id,  content: "Initial call with Arjun — very bullish. Comparing us against two vendors. Key need: API flexibility + SAML SSO. Send a technical brief before next meeting." },
    { leadId: l1.id,  content: "Sent technical brief and pricing deck. Arjun looped in their CFO for budget discussion. Decision expected by end of month." },
    { leadId: l2.id,  content: "Sarah confirmed $500K annual software budget. Procurement involved — expect 90-day vendor evaluation. Need to get on their approved vendor list first." },
    { leadId: l3.id,  content: "Priya asked for a custom proposal with white-labelling options. May want on-premise deployment. Looping in solutions team." },
    { leadId: l8.id,  content: "Neha was referred by Dr. Anjali from the board. Wants a dedicated Slack channel for integration support. Very high intent." },
    { leadId: l8.id,  content: "Shared pilot agreement. Legal review started on their end. Sign-off expected in 2 weeks." },
    { leadId: l9.id,  content: "Anders evaluating two other tools. Our advantage: better Nordic language support + GDPR compliance docs. Send DPA." },
    { leadId: l11.id, content: "Marcus stressed SOC 2 Type II is non-negotiable. Forwarded compliance documents. Security audit scheduled for next week." },
    { leadId: l15.id, content: "Kevin wants a 2-week pilot starting immediately. Assigned senior solutions engineer. Moving fast." },
    { leadId: l18.id, content: "EU data residency is a hard requirement. Confirmed our Frankfurt cluster meets their needs. Shared the DPA." },
  ];
  for (const n of noteData) {
    await db.insert(notesTable).values({ ...n, createdById: actorId });
    await db.insert(activitiesTable).values({ leadId: n.leadId, type: "note_added", description: "added a note", userId: actorId });
  }

  // Follow-ups
  const now = new Date();
  const future = (days: number) => new Date(now.getTime() + days * 86400000);
  const past   = (days: number) => new Date(now.getTime() - days * 86400000);

  const followupData: Array<{ leadId: number; scheduledAt: Date; status: "pending" | "completed" | "rescheduled" | "missed"; notes: string }> = [
    { leadId: l1.id,  scheduledAt: future(2), status: "pending",     notes: "Final commercial negotiation call. Confirm pricing and SLA terms." },
    { leadId: l2.id,  scheduledAt: future(7), status: "pending",     notes: "Follow up on procurement process status." },
    { leadId: l3.id,  scheduledAt: future(3), status: "pending",     notes: "Call to discuss custom proposal feedback." },
    { leadId: l4.id,  scheduledAt: past(1),   status: "missed",      notes: "Introductory demo call." },
    { leadId: l8.id,  scheduledAt: future(1), status: "pending",     notes: "Legal sign-off check-in." },
    { leadId: l9.id,  scheduledAt: past(3),   status: "completed",   notes: "Send GDPR compliance docs and DPA." },
    { leadId: l11.id, scheduledAt: future(5), status: "pending",     notes: "SOC 2 security audit briefing call." },
    { leadId: l12.id, scheduledAt: past(2),   status: "rescheduled", notes: "Demo call — rescheduled to next week." },
    { leadId: l15.id, scheduledAt: future(0), status: "pending",     notes: "Pilot kickoff call with solutions engineer." },
    { leadId: l18.id, scheduledAt: future(4), status: "pending",     notes: "DPA review and pilot timeline discussion." },
  ];
  for (const f of followupData) {
    await db.insert(followupsTable).values({ ...f, createdById: actorId });
    await db.insert(activitiesTable).values({ leadId: f.leadId, type: "followup_added", description: "scheduled a follow-up", userId: actorId });
  }

  // Tasks
  const taskData: Array<{ leadId: number; title: string; description: string; status: "todo" | "in_progress" | "done"; priority: "low" | "medium" | "high" }> = [
    { leadId: l1.id,  title: "Prepare commercial terms sheet",          description: "Draft terms with 20% enterprise discount and 12-month lock-in.", status: "in_progress", priority: "high" },
    { leadId: l1.id,  title: "Get legal sign-off on SLA addendum",      description: "Loop in legal team to review custom SLA clause.",                status: "todo",        priority: "high" },
    { leadId: l2.id,  title: "Complete vendor onboarding form",         description: "Fill GlobalTech's vendor registration portal.",                  status: "todo",        priority: "medium" },
    { leadId: l3.id,  title: "Deliver white-label proposal",            description: "Create custom branded proposal for FinEdge.",                    status: "in_progress", priority: "high" },
    { leadId: l8.id,  title: "Set up dedicated Slack channel",          description: "Create #clarity-health-support Slack channel.",                  status: "done",        priority: "medium" },
    { leadId: l9.id,  title: "Send DPA to legal team",                  description: "Email Data Processing Agreement to anders@polarstar.se.",        status: "done",        priority: "high" },
    { leadId: l11.id, title: "Schedule SOC 2 audit review",             description: "Coordinate with compliance team for Marcus's security audit.",   status: "todo",        priority: "high" },
    { leadId: l15.id, title: "Assign solutions engineer to DataPulse",  description: "Confirm SE availability for 2-week pilot starting immediately.", status: "in_progress", priority: "high" },
    { leadId: l15.id, title: "Prepare pilot environment",               description: "Provision sandbox account with sample data and API keys.",       status: "done",        priority: "high" },
    { leadId: l18.id, title: "Confirm Frankfurt data residency",        description: "Get written confirmation from infra team for EU cluster.",       status: "todo",        priority: "high" },
  ];
  for (const { leadId, ...taskFields } of taskData) {
    await db.insert(tasksTable).values({ leadId, ...taskFields, createdById: actorId });
    await db.insert(activitiesTable).values({ leadId, type: "updated", description: `added task: ${taskFields.title}`, userId: actorId });
  }

  res.json({
    message: "Demo data loaded successfully!",
    summary: { leads: 18, tags: tagDefs.length, notes: noteData.length, followups: followupData.length, tasks: taskData.length },
  });
});

export default router;
