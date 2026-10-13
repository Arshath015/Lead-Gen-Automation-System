/**
 * Idempotent production-data seeder.
 * Runs on server startup. Skips everything if leads table already has ≥ 10 rows.
 *
 * Migrates the 22 demo leads from dev into production, including:
 *  - 2 missing pipeline stages (Follow-up, Meeting Scheduled)
 *  - 5 tags + 14 lead-tag associations
 *  - 1 contact and 1 account
 */
import { db, leadsTable, stagesTable, tagsTable, leadTagsTable, usersTable } from "@workspace/db";
import { sql } from "drizzle-orm";

type LeadChannel = "website" | "whatsapp" | "instagram" | "email" | "apollo" | "referral" | "linkedin" | "database" | "other";
type LeadPriority = "hot" | "warm" | "cold";

// ─── Raw dev data ────────────────────────────────────────────────────────────

const MISSING_STAGES = [
  { name: "Follow-up", color: "#06b6d4", order: 2 },
  { name: "Meeting Scheduled", color: "#8b5cf6", order: 3 },
] as const;

const TAGS = [
  { id: 1, name: "Enterprise" },
  { id: 2, name: "Demo Requested" },
  { id: 3, name: "Inbound" },
  { id: 4, name: "SDR Outreach" },
  { id: 5, name: "High Value" },
];

// dev stage id → prod stage id (direct mapping for stages 1-7; 8 & 9 are inserted at runtime)
// Filled in after we know the inserted IDs for Follow-up and Meeting Scheduled.
type StageMap = Record<number, number>;

// dev owner num_id → prod owner num_id (resolved by email at runtime)
// dev 14 = sandeepkumardey@gmail.com → not in prod → null
// dev 19 = pitcsleads@gmail.com      → prod pitcsleads@gmail.com
// dev 37 = Pitcsleads@gmail.com      → prod Pitcsleads@gmail.com
type OwnerMap = Record<number, number | null>;

const RAW_LEADS: Array<{ devStageId: number; devOwner: number | null; priority: LeadPriority; channel: LeadChannel; valueAmount: string | null; company: string; contact: string; email: string; phone: string | null; location: string | null; designation: string | null; industry: string | null; linkedin: string | null; website: string | null; remarks: string | null; source: "manual" }> = [
  { devStageId: 3, devOwner: null,  priority: "hot",  channel: "referral",   valueAmount: null,     company: "Acme Corp",                    contact: "Sarah Chen",      email: "sarah.chen@acmecorp.com",    phone: "+1 415-555-0182",    location: "San Francisco, CA", designation: "VP of Engineering",       industry: "Technology",        linkedin: "https://linkedin.com/in/sarahchen",     website: null,                          remarks: "Interested in enterprise plan. Has budget approval. Decision expected by end of quarter.", source: "manual" },
  { devStageId: 4, devOwner: null,  priority: "warm", channel: "website",    valueAmount: null,     company: "Bloom Ventures",               contact: "Marcus Williams", email: "m.williams@bloomventures.io", phone: "+1 646-555-0241",    location: "New York, NY",      designation: "CTO",                     industry: "Finance",           linkedin: null,                                     website: "https://bloomventures.io",     remarks: "Came through our website. Evaluating us vs Salesforce. Proposal sent last Tuesday.", source: "manual" },
  { devStageId: 3, devOwner: null,  priority: "hot",  channel: "apollo",     valueAmount: null,     company: "NovaTech Solutions",           contact: "Priya Patel",     email: "priya.patel@novatech.com",   phone: "+1 512-555-0394",    location: "Austin, TX",        designation: "Head of Sales",           industry: "SaaS",              linkedin: null,                                     website: null,                          remarks: "Strong fit. Team of 40 sales reps. Needs white-glove onboarding support.", source: "manual" },
  { devStageId: 1, devOwner: null,  priority: "cold", channel: "email",      valueAmount: null,     company: "LaunchPad Studio",             contact: "James O'Brien",   email: "james@launchpadstudio.co",   phone: "+44 20-555-0178",    location: "London, UK",        designation: "Founder & CEO",           industry: "Design",            linkedin: null,                                     website: null,                          remarks: "Small team (8 people). Budget conscious. Could be a good PLG conversion.", source: "manual" },
  { devStageId: 5, devOwner: null,  priority: "warm", channel: "referral",   valueAmount: null,     company: "Meridian Systems",             contact: "Alex Kim",         email: "akim@meridiansystems.com",   phone: "+1 310-555-0527",    location: "Los Angeles, CA",   designation: "COO",                     industry: "Logistics",         linkedin: null,                                     website: null,                          remarks: "In final negotiation. Needs custom SLA. Legal review underway.", source: "manual" },
  { devStageId: 3, devOwner: null,  priority: "hot",  channel: "instagram",  valueAmount: null,     company: "Skyline Inc",                  contact: "Emma Rodriguez",  email: "emma.rodriguez@skylineinc.com", phone: "+1 305-555-0093", location: "Miami, FL",         designation: "VP of Product",           industry: "Real Estate",       linkedin: null,                                     website: null,                          remarks: "Saw us on Instagram. Booked a demo via our chatbot. Very engaged.", source: "manual" },
  { devStageId: 4, devOwner: null,  priority: "warm", channel: "website",    valueAmount: null,     company: "DataFlow Analytics",           contact: "Daniel Lee",      email: "d.lee@dataflow.ai",          phone: "+1 206-555-0348",    location: "Seattle, WA",       designation: "CEO",                     industry: "Analytics",         linkedin: null,                                     website: null,                          remarks: "Received proposal. Reviewing with CFO this week.", source: "manual" },
  { devStageId: 2, devOwner: null,  priority: "cold", channel: "instagram",  valueAmount: null,     company: "Archway Partners",             contact: "Sophia Nguyen",   email: "s.nguyen@archway.partners",  phone: "+1 617-555-0761",    location: "Boston, MA",        designation: "Director of Business Development", industry: "Consulting",   linkedin: null,                                     website: null,                          remarks: "Cold outreach via Instagram. Initial interest shown, needs nurturing.", source: "manual" },
  { devStageId: 4, devOwner: null,  priority: "hot",  channel: "whatsapp",   valueAmount: null,     company: "GlobalTrade Ltd",              contact: "Ravi Sharma",     email: "ravi.sharma@globaltrade.com", phone: "+91 98765-43210",   location: "Mumbai, India",     designation: "Head of Operations",      industry: "Manufacturing",     linkedin: null,                                     website: null,                          remarks: "Reached via WhatsApp. High urgency — current CRM contract ending next month.", source: "manual" },
  { devStageId: 1, devOwner: null,  priority: "warm", channel: "email",      valueAmount: null,     company: "Lumière Group",                contact: "Chloe Dupont",    email: "c.dupont@lumiere.fr",        phone: "+33 1-555-0829",     location: "Paris, France",     designation: "Sales Manager",           industry: "Retail",            linkedin: null,                                     website: null,                          remarks: "Inbound from our email campaign. Interested in the BD role access features.", source: "manual" },
  { devStageId: 1, devOwner: null,  priority: "warm", channel: "email",      valueAmount: "15000", company: "Summit Industrial Supplies",   contact: "Grace Liang",     email: "g.liang@summitindustrial.com", phone: null,               location: null,                designation: null,                      industry: null,                linkedin: null,                                     website: null,                          remarks: null, source: "manual" },
  { devStageId: 6, devOwner: 14,   priority: "hot",  channel: "referral",   valueAmount: "48000", company: "NorthBridge Logistics",        contact: "Daniel Okafor",   email: "d.okafor@northbridgelog.com", phone: "+1 312-555-0142",   location: "Chicago, IL",       designation: "VP Operations",           industry: "Logistics",         linkedin: "https://linkedin.com/in/danielokafor",   website: "https://northbridgelog.com",   remarks: "Closed annual contract for fleet routing platform. Multi-year deal.", source: "manual" },
  { devStageId: 5, devOwner: 19,   priority: "hot",  channel: "email",      valueAmount: "72000", company: "Vertex Cloud Systems",         contact: "Aisha Rahman",    email: "aisha.r@vertexcloud.io",     phone: "+1 415-555-0188",    location: "San Francisco, CA", designation: "CTO",                     industry: "SaaS",              linkedin: "https://linkedin.com/in/aisharahman",    website: "https://vertexcloud.io",      remarks: "Final pricing negotiation for 200-seat enterprise plan.", source: "manual" },
  { devStageId: 4, devOwner: 14,   priority: "warm", channel: "email",      valueAmount: "55000", company: "Ironclad Security",            contact: "Marcus Bauer",    email: "m.bauer@ironcladsec.com",    phone: "+49 30 555 0193",    location: "Berlin, Germany",   designation: "Head of IT Security",     industry: "Cybersecurity",     linkedin: "https://linkedin.com/in/marcusbauer",    website: "https://ironcladsec.com",     remarks: "Proposal sent for managed SOC services. Awaiting board sign-off.", source: "manual" },
  { devStageId: 3, devOwner: 14,   priority: "hot",  channel: "referral",   valueAmount: "38000", company: "MediCore Health IT",           contact: "Dr. Nisha Verma", email: "n.verma@medicorehit.com",    phone: "+91 22 555 0177",    location: "Mumbai, India",     designation: "Director of Procurement", industry: "Healthcare IT",     linkedin: "https://linkedin.com/in/nishaverma",     website: "https://medicorehit.com",     remarks: "Qualified after demo. Needs HIPAA compliance documentation.", source: "manual" },
  { devStageId: 9, devOwner: 14,   priority: "warm", channel: "email",      valueAmount: "61000", company: "BluePeak Manufacturing",       contact: "Carlos Mendes",   email: "c.mendes@bluepeakmfg.com",   phone: "+55 11 555 0166",    location: "Sao Paulo, Brazil", designation: "Plant Operations Head",   industry: "Manufacturing",     linkedin: "https://linkedin.com/in/carlosmendes",   website: "https://bluepeakmfg.com",     remarks: "Meeting scheduled with procurement committee next week.", source: "manual" },
  { devStageId: 2, devOwner: 19,   priority: "warm", channel: "email",      valueAmount: "29000", company: "Quanta Fintech",               contact: "Emma Thompson",   email: "emma.t@quantafin.com",       phone: "+44 20 555 0155",    location: "London, UK",        designation: "VP Engineering",          industry: "Fintech",           linkedin: "https://linkedin.com/in/emmathompson",   website: "https://quantafin.com",       remarks: "First call done. Evaluating against two competitors.", source: "manual" },
  { devStageId: 8, devOwner: 14,   priority: "cold", channel: "email",      valueAmount: "24000", company: "DataForge Analytics",          contact: "Kenji Sato",      email: "k.sato@dataforge.ai",        phone: "+81 3 555 0144",     location: "Tokyo, Japan",      designation: "Chief Data Officer",      industry: "Data & Analytics",  linkedin: "https://linkedin.com/in/kenjisato",      website: "https://dataforge.ai",        remarks: "Following up after webinar. Interested in API integration.", source: "manual" },
  { devStageId: 3, devOwner: 14,   priority: "hot",  channel: "referral",   valueAmount: "45000", company: "Apex Robotics",                contact: "Sofia Kowalski",  email: "s.kowalski@apexrobotics.com", phone: "+48 22 555 0133",   location: "Warsaw, Poland",    designation: "Automation Lead",         industry: "Robotics & Automation", linkedin: "https://linkedin.com/in/sofiakowalski", website: "https://apexrobotics.com",  remarks: "Qualified. Budget approved for Q3 rollout.", source: "manual" },
  { devStageId: 4, devOwner: 14,   priority: "warm", channel: "email",      valueAmount: "67000", company: "Helios Energy Solutions",      contact: "Omar Haddad",     email: "o.haddad@heliosenergy.com",  phone: "+971 4 555 0122",    location: "Dubai, UAE",        designation: "Procurement Manager",     industry: "Renewable Energy",  linkedin: "https://linkedin.com/in/omarhaddad",     website: "https://heliosenergy.com",    remarks: "Proposal under review by their finance team.", source: "manual" },
  { devStageId: 7, devOwner: null,  priority: "cold", channel: "email",      valueAmount: "12000", company: "CivicSoft Govtech",            contact: "Linda Park",      email: "l.park@civicsoft.gov",       phone: "+1 202-555-0111",    location: "Washington, DC",    designation: "IT Director",             industry: "GovTech",           linkedin: "https://linkedin.com/in/lindapark",      website: "https://civicsoft.gov",       remarks: "Lost to incumbent vendor on procurement compliance terms.", source: "manual" },
  { devStageId: 6, devOwner: 14,   priority: "hot",  channel: "referral",   valueAmount: "83000", company: "Orbit Telecom",                contact: "Raj Malhotra",    email: "r.malhotra@orbittelecom.com", phone: "+91 80 555 0100",   location: "Bangalore, India",  designation: "VP Network Infrastructure", industry: "Telecom",         linkedin: "https://linkedin.com/in/rajmalhotra",    website: "https://orbittelecom.com",    remarks: "Signed! Rolling out CRM across their sales org.", source: "manual" },
];

// dev lead index → tag ids
const LEAD_TAGS: Record<number, number[]> = {
  0:  [1, 2],
  1:  [3],
  2:  [1, 5],
  3:  [3, 4],
  4:  [5],
  5:  [1],
  6:  [2],
  7:  [4],
  8:  [2, 5],
  9:  [3],
};

// ─── Seeder ──────────────────────────────────────────────────────────────────

export async function seedProductionData() {
  // Skip if we already have plenty of leads
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(leadsTable);
  if (count >= 10) {
    console.log(`[seed] Production data already seeded (${count} leads). Skipping.`);
    return;
  }

  console.log("[seed] Starting production data seed…");

  // ── 1. Ensure all stages exist ────────────────────────────────────────────
  const existingStages = await db.select({ id: stagesTable.id, name: stagesTable.name }).from(stagesTable);
  const existingNames = new Set(existingStages.map(s => s.name));

  // Direct ID mapping for stages that already exist in prod with same IDs
  const stageMap: StageMap = { 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7 };

  for (const s of MISSING_STAGES) {
    if (existingNames.has(s.name)) {
      // Already inserted — find its ID
      const found = existingStages.find(e => e.name === s.name);
      if (found) {
        stageMap[s.name === "Follow-up" ? 8 : 9] = found.id;
      }
    } else {
      const [inserted] = await db
        .insert(stagesTable)
        .values({ name: s.name, color: s.color, order: s.order })
        .returning({ id: stagesTable.id });
      stageMap[s.name === "Follow-up" ? 8 : 9] = inserted.id;
      console.log(`[seed] Inserted stage "${s.name}" → id ${inserted.id}`);
    }
  }

  // ── 2. Build user map (by email) ─────────────────────────────────────────
  const prodUsers = await db.select({ numId: usersTable.numId, email: usersTable.email }).from(usersTable);

  const byEmail = (addr: string) =>
    prodUsers.find(u => u.email?.toLowerCase() === addr.toLowerCase())?.numId ?? null;

  // dev num_id → prod num_id
  const ownerMap: OwnerMap = {
    14: null,                              // sandeepkumardey@gmail.com — not in prod
    19: byEmail("pitcsleads@gmail.com"),   // lowercase
    37: byEmail("Pitcsleads@gmail.com"),   // capitalized
  };

  const resolveOwner = (devId: number | null): number | null => {
    if (devId === null) return null;
    return ownerMap[devId] ?? null;
  };

  // ── 3. Insert tags ───────────────────────────────────────────────────────
  const existingTags = await db.select({ id: tagsTable.id, name: tagsTable.name }).from(tagsTable);
  const existingTagNames = new Set(existingTags.map(t => t.name));
  const tagIdMap: Record<number, number> = {};

  for (const tag of TAGS) {
    const existing = existingTags.find(t => t.name === tag.name);
    if (existing) {
      tagIdMap[tag.id] = existing.id;
    } else {
      const [inserted] = await db
        .insert(tagsTable)
        .values({ name: tag.name })
        .returning({ id: tagsTable.id });
      tagIdMap[tag.id] = inserted.id;
      console.log(`[seed] Inserted tag "${tag.name}" → id ${inserted.id}`);
    }
  }

  // ── 4. Insert leads ──────────────────────────────────────────────────────
  const insertedLeadIds: number[] = [];

  for (const lead of RAW_LEADS) {
    const stageId = stageMap[lead.devStageId] ?? stageMap[1];
    const ownerId = resolveOwner(lead.devOwner ?? null);

    const [inserted] = await db
      .insert(leadsTable)
      .values({
        companyName: lead.company,
        contactPerson: lead.contact,
        email: lead.email,
        phone: lead.phone ?? null,
        location: lead.location ?? null,
        designation: lead.designation ?? null,
        industry: lead.industry ?? null,
        linkedinUrl: lead.linkedin ?? null,
        websiteUrl: lead.website ?? null,
        remarks: lead.remarks ?? null,
        source: lead.source as any,
        stageId,
        ownerId,
        priority: lead.priority as any,
        channel: lead.channel ?? null,
        valueAmount: lead.valueAmount ?? null,
        currency: "USD",
      })
      .returning({ id: leadsTable.id });

    insertedLeadIds.push(inserted.id);
  }

  console.log(`[seed] Inserted ${insertedLeadIds.length} leads`);

  // ── 5. Insert lead_tags ──────────────────────────────────────────────────
  for (const [leadIndexStr, devTagIds] of Object.entries(LEAD_TAGS)) {
    const leadIndex = Number(leadIndexStr);
    const leadId = insertedLeadIds[leadIndex];
    if (!leadId) continue;
    for (const devTagId of devTagIds) {
      const prodTagId = tagIdMap[devTagId];
      if (!prodTagId) continue;
      await db
        .insert(leadTagsTable)
        .values({ leadId, tagId: prodTagId })
        .onConflictDoNothing();
    }
  }

  console.log("[seed] Production data seed complete.");
}
