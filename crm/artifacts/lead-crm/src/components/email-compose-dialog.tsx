import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Send, CheckCircle2 } from "lucide-react";
import { useSendLeadEmail, useListEmailTemplates } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { getListNotesQueryKey, getListActivitiesQueryKey } from "@workspace/api-client-react";

interface BuiltinTemplate {
  id: string;
  label: string;
  subject: (ctx: { company: string; contact: string }) => string;
  body: (ctx: { company: string; contact: string; rep: string }) => string;
}

const BUILTIN_TEMPLATES: BuiltinTemplate[] = [
  {
    id: "blank",
    label: "Blank",
    subject: () => "",
    body: () => "",
  },
  {
    id: "introduction",
    label: "Introduction",
    subject: ({ company }) => `Introduction — ${company}`,
    body: ({ contact, rep }) =>
      `Hi ${contact},\n\nI wanted to reach out and introduce myself. I'm ${rep} and I'd love to learn more about ${contact}'s needs and explore how we might be able to help.\n\nWould you be open to a quick 15-minute call this week?\n\nLooking forward to connecting.\n\nBest,\n${rep}`,
  },
  {
    id: "follow_up",
    label: "Follow-up",
    subject: ({ company }) => `Following up — ${company}`,
    body: ({ contact, rep }) =>
      `Hi ${contact},\n\nI just wanted to follow up on my previous message and see if you had a chance to review it.\n\nI understand you're busy, so I'll keep this brief — I'd love to find a time to connect and discuss how we can add value for you.\n\nWould any time this week work?\n\nBest,\n${rep}`,
  },
  {
    id: "proposal",
    label: "Proposal",
    subject: ({ company }) => `Proposal for ${company}`,
    body: ({ contact, company, rep }) =>
      `Hi ${contact},\n\nThank you for taking the time to speak with me. As discussed, I've put together a proposal tailored to ${company}'s needs.\n\nPlease find the key points below:\n\n[Your proposal details here]\n\nI'd love to walk you through this in detail. Are you available for a call later this week?\n\nBest,\n${rep}`,
  },
  {
    id: "meeting_request",
    label: "Meeting Request",
    subject: ({ company }) => `Meeting request — ${company}`,
    body: ({ contact, rep }) =>
      `Hi ${contact},\n\nI'd love to schedule a short meeting to better understand your goals and share how we've helped similar businesses.\n\nWould any of these times work for you?\n• [Day], [Time]\n• [Day], [Time]\n• [Day], [Time]\n\nHappy to adjust to your schedule.\n\nBest,\n${rep}`,
  },
  {
    id: "thank_you",
    label: "Thank You",
    subject: ({ company }) => `Thank you — ${company}`,
    body: ({ contact, rep }) =>
      `Hi ${contact},\n\nThank you for taking the time to meet with me today. It was great learning more about your business and the challenges you're facing.\n\nI'll follow up shortly with the information we discussed. In the meantime, please don't hesitate to reach out if you have any questions.\n\nLooking forward to working together!\n\nBest,\n${rep}`,
  },
];

const BLANK_ID = "blank";

interface EmailInitialValues {
  to?: string;
  subject?: string;
  body?: string;
}

interface EmailComposeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leadId: number;
  toEmail: string;
  contactName: string;
  companyName: string;
  repName?: string;
  initialValues?: EmailInitialValues;
}

export function EmailComposeDialog({
  open,
  onOpenChange,
  leadId,
  toEmail,
  contactName,
  companyName,
  repName = "the team",
  initialValues,
}: EmailComposeDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const ctx = { company: companyName, contact: contactName, rep: repName };

  const { data: apiTemplates = [], isLoading: loadingTemplates } = useListEmailTemplates();

  const useBuiltin = apiTemplates.length === 0;

  const [selectedTemplate, setSelectedTemplate] = useState(BLANK_ID);
  const [to, setTo] = useState(toEmail);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sent, setSent] = useState(false);

  useEffect(() => {
    if (!loadingTemplates && open) {
      if (initialValues) {
        setSelectedTemplate(BLANK_ID);
        setTo(initialValues.to ?? toEmail);
        setSubject(initialValues.subject ?? "");
        setBody(initialValues.body ?? "");
      } else if (useBuiltin) {
        const intro = BUILTIN_TEMPLATES.find((t) => t.id === "introduction")!;
        setSelectedTemplate("introduction");
        setSubject(intro.subject(ctx));
        setBody(intro.body(ctx));
      } else {
        const first = apiTemplates[0];
        setSelectedTemplate(String(first.id));
        setSubject(first.subject);
        setBody(first.body);
      }
    }
  }, [loadingTemplates, open, useBuiltin]);

  const sendEmail = useSendLeadEmail();

  function applyApiTemplate(id: string) {
    setSelectedTemplate(id);
    const t = apiTemplates.find((t) => String(t.id) === id);
    if (!t) return;
    setSubject(t.subject);
    setBody(t.body);
  }

  function applyBuiltinTemplate(id: string) {
    setSelectedTemplate(id);
    const t = BUILTIN_TEMPLATES.find((t) => t.id === id);
    if (!t) return;
    setSubject(t.subject(ctx));
    setBody(t.body(ctx));
  }

  function handleTemplateChange(id: string) {
    if (useBuiltin) {
      applyBuiltinTemplate(id);
    } else {
      applyApiTemplate(id);
    }
  }

  function handleOpenChange(v: boolean) {
    if (!v) {
      setSelectedTemplate(BLANK_ID);
      setTo(toEmail);
      setSubject("");
      setBody("");
      setSent(false);
    }
    onOpenChange(v);
  }

  async function handleSend() {
    if (!to.trim() || !subject.trim() || !body.trim()) {
      toast({ title: "Please fill in all fields", variant: "destructive" });
      return;
    }

    try {
      const result = await sendEmail.mutateAsync({
        leadId,
        data: { to: to.trim(), subject: subject.trim(), body: body.trim(), templateId: selectedTemplate },
      });

      queryClient.invalidateQueries({ queryKey: getListNotesQueryKey(leadId) });
      queryClient.invalidateQueries({ queryKey: getListActivitiesQueryKey(leadId) });

      setSent(true);
      if (result.sent) {
        toast({ title: "Email sent", description: `Sent to ${to} and logged on the timeline.` });
      } else {
        toast({
          title: "Email logged",
          description: result.message ?? "Email was logged on the timeline. Configure RESEND_API_KEY to enable actual sending.",
        });
      }
      setTimeout(() => handleOpenChange(false), 1500);
    } catch {
      toast({ title: "Failed to send email", variant: "destructive" });
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[580px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Send className="h-4 w-4" /> Send Email
          </DialogTitle>
        </DialogHeader>

        {sent ? (
          <div className="flex flex-col items-center justify-center py-8 gap-3 text-center">
            <CheckCircle2 className="h-12 w-12 text-green-500" />
            <p className="font-medium">Email logged on the timeline</p>
          </div>
        ) : (
          <div className="space-y-4 py-1">
            <div className="space-y-1.5">
              <Label>Template</Label>
              {loadingTemplates ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />Loading templates…
                </div>
              ) : (
                <Select value={selectedTemplate} onValueChange={handleTemplateChange}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {useBuiltin
                      ? BUILTIN_TEMPLATES.map((t) => (
                          <SelectItem key={t.id} value={t.id}>{t.label}</SelectItem>
                        ))
                      : apiTemplates.map((t) => (
                          <SelectItem key={t.id} value={String(t.id)}>{t.name}</SelectItem>
                        ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            <div className="space-y-1.5">
              <Label>To</Label>
              <Input value={to} onChange={(e) => setTo(e.target.value)} placeholder="recipient@example.com" type="email" />
            </div>

            <div className="space-y-1.5">
              <Label>Subject</Label>
              <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Email subject" />
            </div>

            <div className="space-y-1.5">
              <Label>Message</Label>
              <Textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Write your message..."
                className="min-h-[180px] resize-none font-mono text-sm"
              />
            </div>
          </div>
        )}

        {!sent && (
          <DialogFooter>
            <Button variant="outline" onClick={() => handleOpenChange(false)}>Cancel</Button>
            <Button onClick={handleSend} disabled={sendEmail.isPending || !to || !subject || !body}>
              {sendEmail.isPending ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Sending…</>
              ) : (
                <><Send className="h-4 w-4 mr-2" />Send & Log</>
              )}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
