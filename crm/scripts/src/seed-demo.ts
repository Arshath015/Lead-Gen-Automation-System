import {
  db,
  stagesTable,
  leadsTable,
  tagsTable,
  leadTagsTable,
  tasksTable,
  followupsTable,
  notesTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";

async function seedDemo() {
  console.log("🌱 Seeding demo data for Rapport...\n");

  // ── 1. Stages ──────────────────────────────────────────────────────────────
  let stages = await db.select().from(stagesTable);
  if (stages.length === 0) {
    console.log("Seeding stages...");
    await db.insert(stagesTable).values([
      { name: "New Lead",      color: "#6366f1", order: 0, isDefault: true,  isWon: false, isLost: false },
      { name: "Contacted",     color: "#8b5cf6", order: 1, isDefault: false, isWon: false, isLost: false },
      { name: "Qualified",     color: "#f59e0b", order: 2, isDefault: false, isWon: false, isLost: false },
      { name: "Proposal Sent", color: "#3b82f6", order: 3, isDefault: false, isWon: false, isLost: false },
      { name: "Negotiation",   color: "#f97316", order: 4, isDefault: false, isWon: false, isLost: false },
      { name: "Won",           color: "#10b981", order: 5, isDefault: false, isWon: true,  isLost: false },
      { name: "Lost",          color: "#ef4444", order: 6, isDefault: false, isWon: false, isLost: true  },
    ]);
    stages = await db.select().from(stagesTable);
    console.log("  ✓ Stages");
  } else {
    console.log("  ✓ Stages already exist");
  }

  const stageByName = Object.fromEntries(stages.map(s => [s.name, s]));

  // ── 2. Tags ────────────────────────────────────────────────────────────────
  console.log("Seeding tags...");
  const existingTags = await db.select().from(tagsTable);
  const existingTagNames = new Set(existingTags.map(t => t.name));

  const tagDefs = [
    { name: "Enterprise",      color: "#6366f1" },
    { name: "Demo Requested",  color: "#f59e0b" },
    { name: "Inbound",         color: "#10b981" },
    { name: "SDR Outreach",    color: "#8b5cf6" },
    { name: "High Value",      color: "#ef4444" },
  ];
  for (const t of tagDefs) {
    if (!existingTagNames.has(t.name)) {
      await db.insert(tagsTable).values(t);
    }
  }
  const allTags = await db.select().from(tagsTable);
  const tagByName = Object.fromEntries(allTags.map(t => [t.name, t]));
  console.log("  ✓ Tags:", Object.keys(tagByName).join(", "));

  // ── 3. Skip if demo leads already exist ────────────────────────────────────
  const existingLeads = await db.select().from(leadsTable);
  if (existingLeads.length >= 5) {
    console.log("\n⚠️  5+ leads already exist — skipping demo lead creation.");
    console.log("   Run with --force to wipe and re-seed (not implemented here).");
    process.exit(0);
  }

  // ── 4. Leads ───────────────────────────────────────────────────────────────
  console.log("Seeding leads...");

  const now = new Date();
  const daysFromNow = (n: number) => new Date(now.getTime() + n * 86_400_000);

  const leadData = [
    {
      contactPerson: "Sarah Chen",
      designation: "VP of Engineering",
      companyName: "Acme Corp",
      email: "sarah.chen@acmecorp.com",
      phone: "+1 415-555-0182",
      location: "San Francisco, CA",
      industry: "Technology",
      linkedinUrl: "https://linkedin.com/in/sarahchen",
      remarks: "Interested in enterprise plan. Has budget approval. Decision expected by end of quarter.",
      priority: "hot" as const,
      channel: "referral" as const,
      stageName: "Qualified",
      tags: ["Enterprise", "Demo Requested"],
    },
    {
      contactPerson: "Marcus Williams",
      designation: "CTO",
      companyName: "Bloom Ventures",
      email: "m.williams@bloomventures.io",
      phone: "+1 646-555-0241",
      location: "New York, NY",
      industry: "Finance",
      websiteUrl: "https://bloomventures.io",
      remarks: "Came through our website. Evaluating us vs Salesforce. Proposal sent last Tuesday.",
      priority: "warm" as const,
      channel: "website" as const,
      stageName: "Proposal Sent",
      tags: ["Inbound"],
    },
    {
      contactPerson: "Priya Patel",
      designation: "Head of Sales",
      companyName: "NovaTech Solutions",
      email: "priya.patel@novatech.com",
      phone: "+1 512-555-0394",
      location: "Austin, TX",
      industry: "SaaS",
      remarks: "Strong fit. Team of 40 sales reps. Needs white-glove onboarding support.",
      priority: "hot" as const,
      channel: "apollo" as const,
      stageName: "Qualified",
      tags: ["Enterprise", "High Value"],
    },
    {
      contactPerson: "James O'Brien",
      designation: "Founder & CEO",
      companyName: "LaunchPad Studio",
      email: "james@launchpadstudio.co",
      phone: "+44 20-555-0178",
      location: "London, UK",
      industry: "Design",
      remarks: "Small team (8 people). Budget conscious. Could be a good PLG conversion.",
      priority: "cold" as const,
      channel: "email" as const,
      stageName: "New Lead",
      tags: ["Inbound", "SDR Outreach"],
    },
    {
      contactPerson: "Alex Kim",
      designation: "COO",
      companyName: "Meridian Systems",
      email: "akim@meridiansystems.com",
      phone: "+1 310-555-0527",
      location: "Los Angeles, CA",
      industry: "Logistics",
      remarks: "In final negotiation. Needs custom SLA. Legal review underway.",
      priority: "warm" as const,
      channel: "referral" as const,
      stageName: "Negotiation",
      tags: ["High Value"],
    },
    {
      contactPerson: "Emma Rodriguez",
      designation: "VP of Product",
      companyName: "Skyline Inc",
      email: "emma.rodriguez@skylineinc.com",
      phone: "+1 305-555-0093",
      location: "Miami, FL",
      industry: "Real Estate",
      remarks: "Saw us on Instagram. Booked a demo via our chatbot. Very engaged.",
      priority: "hot" as const,
      channel: "instagram" as const,
      stageName: "Qualified",
      tags: ["Enterprise"],
    },
    {
      contactPerson: "Daniel Lee",
      designation: "CEO",
      companyName: "DataFlow Analytics",
      email: "d.lee@dataflow.ai",
      phone: "+1 206-555-0348",
      location: "Seattle, WA",
      industry: "Analytics",
      remarks: "Received proposal. Reviewing with CFO this week.",
      priority: "warm" as const,
      channel: "website" as const,
      stageName: "Proposal Sent",
      tags: ["Demo Requested"],
    },
    {
      contactPerson: "Sophia Nguyen",
      designation: "Director of Business Development",
      companyName: "Archway Partners",
      email: "s.nguyen@archway.partners",
      phone: "+1 617-555-0761",
      location: "Boston, MA",
      industry: "Consulting",
      remarks: "Cold outreach via Instagram. Initial interest shown, needs nurturing.",
      priority: "cold" as const,
      channel: "instagram" as const,
      stageName: "Contacted",
      tags: ["SDR Outreach"],
    },
    {
      contactPerson: "Ravi Sharma",
      designation: "Head of Operations",
      companyName: "GlobalTrade Ltd",
      email: "ravi.sharma@globaltrade.com",
      phone: "+91 98765-43210",
      location: "Mumbai, India",
      industry: "Manufacturing",
      remarks: "Reached via WhatsApp. High urgency — current CRM contract ending next month.",
      priority: "hot" as const,
      channel: "whatsapp" as const,
      stageName: "Qualified",
      tags: ["High Value", "Demo Requested"],
    },
    {
      contactPerson: "Chloe Dupont",
      designation: "Sales Manager",
      companyName: "Lumière Group",
      email: "c.dupont@lumiere.fr",
      phone: "+33 1-555-0829",
      location: "Paris, France",
      industry: "Retail",
      remarks: "Inbound from our email campaign. Interested in the BD role access features.",
      priority: "warm" as const,
      channel: "email" as const,
      stageName: "New Lead",
      tags: ["Inbound"],
    },
  ];

  const insertedLeads: Array<{ id: number; contactPerson: string }> = [];

  for (const lead of leadData) {
    const stage = stageByName[lead.stageName];
    const [inserted] = await db.insert(leadsTable).values({
      contactPerson: lead.contactPerson,
      designation: lead.designation,
      companyName: lead.companyName,
      email: lead.email,
      phone: lead.phone,
      location: lead.location,
      industry: lead.industry,
      linkedinUrl: lead.linkedinUrl,
      websiteUrl: lead.websiteUrl,
      remarks: lead.remarks,
      priority: lead.priority,
      channel: lead.channel,
      stageId: stage?.id ?? null,
      source: "manual",
    }).returning({ id: leadsTable.id });

    insertedLeads.push({ id: inserted.id, contactPerson: lead.contactPerson });

    // Tags
    for (const tagName of lead.tags) {
      const tag = tagByName[tagName];
      if (tag) {
        await db.insert(leadTagsTable).values({ leadId: inserted.id, tagId: tag.id });
      }
    }
  }
  console.log(`  ✓ ${insertedLeads.length} leads inserted`);

  // ── 5. Notes ───────────────────────────────────────────────────────────────
  console.log("Seeding notes...");
  const sarahId  = insertedLeads.find(l => l.contactPerson === "Sarah Chen")?.id;
  const marcusId = insertedLeads.find(l => l.contactPerson === "Marcus Williams")?.id;
  const priyaId  = insertedLeads.find(l => l.contactPerson === "Priya Patel")?.id;
  const alexId   = insertedLeads.find(l => l.contactPerson === "Alex Kim")?.id;

  const noteData = [
    { leadId: sarahId,  content: "Had a great call with Sarah — she confirmed internal budget sign-off. Wants to move fast. Sending enterprise pricing deck today." },
    { leadId: sarahId,  content: "Demo went very well. Their team of 12 BDs loved the bulk assign feature. Follow-up scheduled for Friday." },
    { leadId: marcusId, content: "Marcus compared us with Salesforce Essentials. Our pricing is 40% lower with better role controls. Confident we can close." },
    { leadId: priyaId,  content: "Priya needs white-glove onboarding for her 40-person sales team. Looping in Customer Success." },
    { leadId: alexId,   content: "Legal review started. Their counsel flagged the data retention clause — escalated to our legal team." },
  ];
  for (const note of noteData) {
    if (note.leadId) {
      await db.insert(notesTable).values({ leadId: note.leadId, content: note.content });
    }
  }
  console.log("  ✓ Notes");

  // ── 6. Tasks ───────────────────────────────────────────────────────────────
  console.log("Seeding tasks...");
  const taskData = [
    { leadId: sarahId,  title: "Follow up on proposal",          description: "Check if Sarah reviewed the enterprise pricing deck and has questions.", dueDate: daysFromNow(1),  status: "todo"        as const, priority: "high"   as const },
    { leadId: sarahId,  title: "Send enterprise pricing deck",    description: "Attach the updated Q3 enterprise tier PDF.", dueDate: daysFromNow(0),  status: "in_progress" as const, priority: "high"   as const },
    { leadId: marcusId, title: "Schedule technical demo",         description: "Marcus wants to see the API and CSV import in action.", dueDate: daysFromNow(1),  status: "todo"        as const, priority: "high"   as const },
    { leadId: marcusId, title: "Prepare competitive comparison",  description: "Put together a one-pager vs Salesforce Essentials.", dueDate: daysFromNow(3),  status: "todo"        as const, priority: "medium" as const },
    { leadId: priyaId,  title: "Loop in Customer Success",        description: "Intro Priya's team to our CS lead for onboarding scoping.", dueDate: daysFromNow(2),  status: "done"        as const, priority: "medium" as const },
    { leadId: priyaId,  title: "Send NDA document",               description: "Priya's legal team requires NDA before sharing architecture docs.", dueDate: daysFromNow(0),  status: "in_progress" as const, priority: "high"   as const },
    { leadId: alexId,   title: "Resolve data retention clause",   description: "Coordinate with our legal team on the retention policy wording.", dueDate: daysFromNow(2),  status: "todo"        as const, priority: "high"   as const },
    { leadId: alexId,   title: "Prepare final contract draft",    description: "Incorporate agreed changes and send final version to Alex.", dueDate: daysFromNow(5),  status: "todo"        as const, priority: "medium" as const },
  ];
  for (const task of taskData) {
    if (task.leadId) {
      await db.insert(tasksTable).values({
        leadId:   task.leadId,
        title:    task.title,
        description: task.description,
        dueDate:  task.dueDate,
        status:   task.status,
        priority: task.priority,
      });
    }
  }
  console.log("  ✓ Tasks");

  // ── 7. Follow-ups ──────────────────────────────────────────────────────────
  console.log("Seeding follow-ups...");
  const followupData = [
    { leadId: sarahId,  scheduledAt: daysFromNow(1),   notes: "Check in on the proposal — confirm whether Sarah wants to proceed or has further questions.", status: "pending"   as const },
    { leadId: sarahId,  scheduledAt: daysFromNow(-3),  notes: "Initial discovery call — discussed pain points with their current spreadsheet setup.", status: "completed" as const },
    { leadId: marcusId, scheduledAt: daysFromNow(2),   notes: "Technical demo session. Marcus will have their senior engineer on the call.", status: "pending"   as const },
    { leadId: marcusId, scheduledAt: daysFromNow(-7),  notes: "Cold outreach — Marcus responded positively and requested more info.", status: "completed" as const },
    { leadId: priyaId,  scheduledAt: daysFromNow(3),   notes: "Onboarding scoping call with CS team.", status: "pending"   as const },
    { leadId: alexId,   scheduledAt: daysFromNow(4),   notes: "Final contract review call with Alex and their legal team.", status: "pending"   as const },
    { leadId: alexId,   scheduledAt: daysFromNow(-1),  notes: "Negotiation call — agreed on pricing, legal review remaining.", status: "completed" as const },
  ];
  for (const f of followupData) {
    if (f.leadId) {
      await db.insert(followupsTable).values({
        leadId:      f.leadId,
        scheduledAt: f.scheduledAt,
        notes:       f.notes,
        status:      f.status,
      });
    }
  }
  console.log("  ✓ Follow-ups");

  console.log("\n✅ Demo seed complete!");
  console.log(`   ${insertedLeads.length} leads · ${taskData.length} tasks · ${noteData.length} notes · ${followupData.length} follow-ups`);
  process.exit(0);
}

seedDemo().catch(err => { console.error(err); process.exit(1); });
