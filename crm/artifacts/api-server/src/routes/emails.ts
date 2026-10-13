import { Router } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { notesTable, leadsTable, activitiesTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { getAllowedOwnerIds, type ScopeUser } from "../lib/scope";
import { requirePermission } from "../lib/permissions";

const router = Router();

const SendEmailInputSchema = z.object({
  to: z.string().email("Invalid recipient email address"),
  subject: z.string().min(1, "Subject is required"),
  body: z.string().default(""),
  templateId: z.string().nullable().optional(),
});

router.post("/leads/:leadId/send-email", requirePermission("leads.edit"), async (req, res) => {
  const leadId = Number(req.params.leadId);
  if (isNaN(leadId)) return res.status(400).json({ error: "Invalid lead ID" });

  const parsed = SendEmailInputSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { to, subject, body } = parsed.data;

  const [lead] = await db.select().from(leadsTable).where(eq(leadsTable.id, leadId)).limit(1);
  if (!lead) return res.status(404).json({ error: "Lead not found" });

  const allowedOwnerIds = await getAllowedOwnerIds(req.user! as ScopeUser);
  if (allowedOwnerIds !== null) {
    const allowed = req.user!.role === "bd"
      ? lead.ownerId === req.user!.id
      : lead.ownerId === null || allowedOwnerIds.includes(lead.ownerId);
    if (!allowed) return res.status(403).json({ error: "Forbidden" });
  }

  const userId = req.user!.id;
  let sent = false;
  let sendMessage: string | null = null;

  const resendKey = process.env.RESEND_API_KEY;
  if (resendKey) {
    try {
      const fromAddress = process.env.EMAIL_FROM ?? "Rapport <onboarding@resend.dev>";
      const resp = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: fromAddress,
          to: [to],
          subject,
          text: body,
          html: body.replace(/\n/g, "<br>"),
        }),
      });
      if (resp.ok) {
        sent = true;
      } else {
        const errJson = await resp.json().catch(() => ({}));
        sendMessage = (errJson as { message?: string }).message ?? `Resend error ${resp.status}`;
        req.log.warn({ leadId, status: resp.status, msg: sendMessage }, "Resend API error");
      }
    } catch (err) {
      sendMessage = "Email delivery failed — logged only";
      req.log.error({ err, leadId }, "Resend fetch error");
    }
  } else {
    sendMessage = "Email delivery not configured — logged only";
  }

  const noteContent = `**To:** ${to}\n**Subject:** ${subject}\n\n${body}`;
  const [note] = await db
    .insert(notesTable)
    .values({
      leadId,
      content: noteContent,
      type: "email",
      createdById: userId,
    })
    .returning();

  await db.insert(activitiesTable).values({
    leadId,
    userId,
    type: "note_added",
    description: `Email sent to ${to}: "${subject}"`,
    newValue: `email:${note.id}`,
  });

  return res.json({ logged: true, sent, noteId: note.id, message: sendMessage });
});

export default router;
