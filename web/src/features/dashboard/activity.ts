import type { EmailDraft, Lead, ResearchBrief } from "../../types";

export interface ActivityEvent {
  id: string;
  leadName: string;
  text: string;
  at: string;
}

export function buildActivity(
  leads: Lead[],
  briefsByLead: Record<string, ResearchBrief>,
  draftsByLead: Record<string, EmailDraft>
): ActivityEvent[] {
  const events: ActivityEvent[] = [];

  for (const lead of leads) {
    const brief = briefsByLead[lead.id];
    const draft = draftsByLead[lead.id];

    const candidates: { at: string; text: string }[] = [{ at: lead.createdAt, text: "was added" }];

    if (lead.updatedAt !== lead.createdAt) {
      candidates.push({
        at: lead.updatedAt,
        text: lead.email
          ? "had their email revealed"
          : lead.status !== "new"
          ? `was marked ${lead.status}`
          : "was updated",
      });
    }
    if (brief) {
      candidates.push({
        at: brief.updatedAt,
        text: brief.status === "failed" ? "research failed" : brief.editedByUser ? "research was edited" : "was researched",
      });
    }
    if (draft) {
      candidates.push({
        at: draft.updatedAt,
        text: draft.editedByUser ? "draft was edited" : "got a draft generated",
      });
      if (draft.sentAt) {
        candidates.push({ at: draft.sentAt, text: "was sent an email" });
      }
    }

    candidates.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
    const latest = candidates[0];
    events.push({ id: lead.id, leadName: lead.fullName, text: latest.text, at: latest.at });
  }

  return events.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
}
