import { useState, useEffect } from "react";
import {
  useListStages, useCreateStage, useUpdateStage, useDeleteStage,
  useListAutomationRules, useCreateAutomationRule, useUpdateAutomationRule, useDeleteAutomationRule,
  useListEmailTemplates, useCreateEmailTemplate, useUpdateEmailTemplate, useDeleteEmailTemplate,
  getListStagesQueryKey, getListAutomationRulesQueryKey, getListEmailTemplatesQueryKey,
  provisionWebToLeadToken,
  type AutomationRule, type AutomationRuleInput,
  type EmailTemplate, type EmailTemplateInput,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Plus, Pencil, Trash2, GripVertical, Zap, Settings2, User, Bell, Building2, Mail, Globe, Phone, MapPin, MessageSquare, Server, Palette, Link2, Copy } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@workspace/replit-auth-web";

const STAGE_COLORS = ["#6366f1", "#8b5cf6", "#06b6d4", "#3b82f6", "#f59e0b", "#f97316", "#10b981", "#ef4444", "#ec4899", "#14b8a6"];

const TRIGGER_OPTIONS = [
  { value: "new_lead", label: "New lead created" },
  { value: "stage_change", label: "Stage changed" },
  { value: "field_value", label: "Field value matches" },
];

const ACTION_OPTIONS = [
  { value: "create_followup", label: "Create follow-up task" },
  { value: "send_notification", label: "Send notification" },
  { value: "auto_assign", label: "Auto-assign to user" },
];

const EMPTY_RULE: AutomationRuleInput = {
  name: "",
  trigger: "new_lead",
  actionType: "create_followup",
  isActive: true,
};

export default function Settings() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();
  const isAdmin = (user as any)?.role === "admin";

  // Stages
  const { data: stages, isLoading } = useListStages();
  const createStage = useCreateStage();
  const updateStage = useUpdateStage();
  const deleteStage = useDeleteStage();

  const [addOpen, setAddOpen] = useState(false);
  const [editStage, setEditStage] = useState<{ id: number; name: string; color: string } | null>(null);
  const [newStage, setNewStage] = useState({ name: "", color: STAGE_COLORS[0] });

  // Notification preferences
  const defaultNotifPrefs = {
    emailNotificationsEnabled: false,
    notifyNewLead: false,
    notifyStatusChange: false,
    notifyOnSubordinateManualLead: false,
    notifyOnManagerActivity: false,
    notifyOnAdminActivity: false,
    notifyCallReminders: false,
    notifyMeetingTaskReminders: false,
    notifyImportantFieldChange: false,
    notifyUrgentEscalation: false,
  };
  const [notifPrefs, setNotifPrefs] = useState(defaultNotifPrefs);
  const [notifLoading, setNotifLoading] = useState(false);
  const [notifSaving, setNotifSaving] = useState(false);
  const [testEmailSending, setTestEmailSending] = useState(false);

  useEffect(() => {
    setNotifLoading(true);
    fetch("/api/settings/notification-preferences", { credentials: "include" })
      .then(r => r.json())
      .then(d => setNotifPrefs({
        emailNotificationsEnabled: d.emailNotificationsEnabled ?? false,
        notifyNewLead: d.notifyNewLead ?? false,
        notifyStatusChange: d.notifyStatusChange ?? false,
        notifyOnSubordinateManualLead: d.notifyOnSubordinateManualLead ?? false,
        notifyOnManagerActivity: d.notifyOnManagerActivity ?? false,
        notifyOnAdminActivity: d.notifyOnAdminActivity ?? false,
        notifyCallReminders: d.notifyCallReminders ?? false,
        notifyMeetingTaskReminders: d.notifyMeetingTaskReminders ?? false,
        notifyImportantFieldChange: d.notifyImportantFieldChange ?? false,
        notifyUrgentEscalation: d.notifyUrgentEscalation ?? false,
      }))
      .catch(() => {})
      .finally(() => setNotifLoading(false));
  }, []);

  const handleSendTestEmail = async () => {
    setTestEmailSending(true);
    try {
      const res = await fetch("/api/notifications/test-email", {
        method: "POST",
        credentials: "include",
        headers: { "X-CSRF-Protection": "1" },
      });
      const data = await res.json();
      if (res.ok) {
        toast({ title: "Test email sent", description: `Check your inbox at ${data.sentTo}` });
      } else {
        toast({ title: "Failed to send test email", description: data.error ?? "Unknown error", variant: "destructive" });
      }
    } catch {
      toast({ title: "Failed to send test email", variant: "destructive" });
    } finally {
      setTestEmailSending(false);
    }
  };

  const handleSaveNotifPrefs = async () => {
    setNotifSaving(true);
    try {
      await fetch("/api/settings/notification-preferences", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json", "x-requested-with": "XMLHttpRequest" },
        body: JSON.stringify(notifPrefs),
      });
      toast({ title: "Notification preferences saved" });
    } catch {
      toast({ title: "Failed to save", variant: "destructive" });
    } finally {
      setNotifSaving(false);
    }
  };

  // Org settings
  const [orgForm, setOrgForm] = useState({
    name: "", currency: "INR", timezone: "UTC",
    logoUrl: "", primaryColor: "#3b82f6", theme: "system", domain: "",
    businessEmail: "", businessPhone: "", address: "",
    website: "", businessType: "", industry: "", employeeCount: "",
    smtpHost: "", smtpPort: "587", smtpUser: "", smtpPass: "", smtpFrom: "",
    whatsappPhoneNumberId: "", whatsappApiKey: "", whatsappBusinessName: "",
  });
  const [orgLoading, setOrgLoading] = useState(false);
  const [orgSaving, setOrgSaving] = useState(false);
  const [webToLeadToken, setWebToLeadToken] = useState("");
  const [webToLeadProvisioning, setWebToLeadProvisioning] = useState(false);

  useEffect(() => {
    setOrgLoading(true);
    fetch("/api/settings/org", { credentials: "include" })
      .then(r => r.json())
      .then(d => {
        const smtp = (d.smtpConfig as any) ?? {};
        const wa = (d.whatsappConfig as any) ?? {};
        setOrgForm({
          name: d.name ?? "",
          currency: d.currency ?? "INR",
          timezone: d.timezone ?? "UTC",
          logoUrl: d.logoUrl ?? "",
          primaryColor: d.primaryColor ?? "#3b82f6",
          theme: d.theme ?? "system",
          domain: d.domain ?? "",
          businessEmail: d.businessEmail ?? "",
          businessPhone: d.businessPhone ?? "",
          address: d.address ?? "",
          website: d.website ?? "",
          businessType: d.businessType ?? "",
          industry: d.industry ?? "",
          employeeCount: d.employeeCount ?? "",
          smtpHost: smtp.host ?? "",
          smtpPort: String(smtp.port ?? "587"),
          smtpUser: smtp.user ?? "",
          smtpPass: smtp.pass ?? "",
          smtpFrom: smtp.from ?? "",
          whatsappPhoneNumberId: wa.phoneNumberId ?? "",
          whatsappApiKey: wa.apiKey ?? "",
          whatsappBusinessName: wa.businessName ?? "",
        });
      })
      .catch(() => {})
      .finally(() => setOrgLoading(false));
  }, []);

  const handleSaveOrg = async () => {
    setOrgSaving(true);
    try {
      const payload = {
        name: orgForm.name,
        currency: orgForm.currency,
        timezone: orgForm.timezone,
        logoUrl: orgForm.logoUrl,
        primaryColor: orgForm.primaryColor,
        theme: orgForm.theme,
        domain: orgForm.domain,
        businessEmail: orgForm.businessEmail,
        businessPhone: orgForm.businessPhone,
        address: orgForm.address,
        website: orgForm.website,
        businessType: orgForm.businessType,
        industry: orgForm.industry,
        employeeCount: orgForm.employeeCount,
        smtpConfig: {
          host: orgForm.smtpHost,
          port: parseInt(orgForm.smtpPort) || 587,
          user: orgForm.smtpUser,
          pass: orgForm.smtpPass,
          from: orgForm.smtpFrom,
        },
        whatsappConfig: {
          phoneNumberId: orgForm.whatsappPhoneNumberId,
          apiKey: orgForm.whatsappApiKey,
          businessName: orgForm.whatsappBusinessName,
        },
      };
      const res = await fetch("/api/settings/org", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Failed");
      toast({ title: "Organisation settings saved" });
    } catch {
      toast({ title: "Failed to save", variant: "destructive" });
    } finally {
      setOrgSaving(false);
    }
  };

  const handleProvisionWebToLead = async () => {
    setWebToLeadProvisioning(true);
    try {
      const data = await provisionWebToLeadToken({
        headers: { "X-CSRF-Protection": "1", "x-requested-with": "XMLHttpRequest" },
      });
      setWebToLeadToken(data.token);
      toast({ title: "Web-to-lead link generated", description: "Any previous link has been replaced." });
    } catch (error: any) {
      toast({ title: "Failed to generate link", description: error.message, variant: "destructive" });
    } finally {
      setWebToLeadProvisioning(false);
    }
  };

  const handleCopyWebToLeadLink = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/web-to-lead#token=${encodeURIComponent(webToLeadToken)}`);
      toast({ title: "Link copied" });
    } catch {
      toast({ title: "Could not copy link", description: "Select and copy the link manually.", variant: "destructive" });
    }
  };

  // Automation
  const { data: rules, isLoading: loadingRules } = useListAutomationRules();
  const createRule = useCreateAutomationRule();
  const updateRule = useUpdateAutomationRule();
  const deleteRule = useDeleteAutomationRule();
  const [ruleDialogOpen, setRuleDialogOpen] = useState(false);
  const [editRule, setEditRule] = useState<AutomationRule | null>(null);
  const [ruleForm, setRuleForm] = useState<AutomationRuleInput>(EMPTY_RULE);

  const invalidateStages = () => queryClient.invalidateQueries({ queryKey: getListStagesQueryKey() });
  const invalidateRules = () => queryClient.invalidateQueries({ queryKey: getListAutomationRulesQueryKey() });
  const invalidateEmailTemplates = () => queryClient.invalidateQueries({ queryKey: getListEmailTemplatesQueryKey() });

  // Email Templates (admin only)
  const { data: emailTemplates, isLoading: loadingEmailTemplates } = useListEmailTemplates({ includeInactive: true });
  const createEmailTemplate = useCreateEmailTemplate();
  const updateEmailTemplate = useUpdateEmailTemplate();
  const deleteEmailTemplate = useDeleteEmailTemplate();
  const [emailTplDialogOpen, setEmailTplDialogOpen] = useState(false);
  const [editEmailTpl, setEditEmailTpl] = useState<EmailTemplate | null>(null);
  const [emailTplForm, setEmailTplForm] = useState<EmailTemplateInput>({ name: "", subject: "", body: "", isActive: true });

  const openCreateEmailTpl = () => {
    setEditEmailTpl(null);
    setEmailTplForm({ name: "", subject: "", body: "", isActive: true });
    setEmailTplDialogOpen(true);
  };
  const openEditEmailTpl = (t: EmailTemplate) => {
    setEditEmailTpl(t);
    setEmailTplForm({ name: t.name, subject: t.subject, body: t.body, isActive: t.isActive });
    setEmailTplDialogOpen(true);
  };

  const handleSaveEmailTpl = async () => {
    if (!emailTplForm.name?.trim() || !emailTplForm.subject?.trim() || !emailTplForm.body?.trim()) {
      toast({ title: "Name, subject, and body are required", variant: "destructive" });
      return;
    }
    try {
      if (editEmailTpl) {
        await updateEmailTemplate.mutateAsync({ id: editEmailTpl.id, data: emailTplForm });
        toast({ title: "Template updated" });
      } else {
        await createEmailTemplate.mutateAsync({ data: emailTplForm });
        toast({ title: "Template created" });
      }
      setEmailTplDialogOpen(false);
      invalidateEmailTemplates();
    } catch (e: any) {
      toast({ title: "Failed to save template", description: e.message, variant: "destructive" });
    }
  };

  const handleDeleteEmailTpl = async (id: number) => {
    if (!confirm("Delete this email template?")) return;
    try {
      await deleteEmailTemplate.mutateAsync({ id });
      toast({ title: "Template deleted" });
      invalidateEmailTemplates();
    } catch (e: any) {
      toast({ title: "Failed to delete template", description: e.message, variant: "destructive" });
    }
  };

  const handleAdd = async () => {
    if (!newStage.name.trim()) return;
    try {
      await createStage.mutateAsync({ data: { name: newStage.name.trim(), color: newStage.color, order: (stages?.length ?? 0) } });
      toast({ title: "Stage created" });
      setAddOpen(false);
      setNewStage({ name: "", color: STAGE_COLORS[0] });
      invalidateStages();
    } catch (e: any) {
      toast({ title: "Failed to create stage", description: e.message, variant: "destructive" });
    }
  };

  const handleEdit = async () => {
    if (!editStage) return;
    try {
      await updateStage.mutateAsync({ id: editStage.id, data: { name: editStage.name, color: editStage.color } });
      toast({ title: "Stage updated" });
      setEditStage(null);
      invalidateStages();
    } catch (e: any) {
      toast({ title: "Failed to update stage", description: e.message, variant: "destructive" });
    }
  };

  const handleDeleteStage = async (id: number, name: string) => {
    if (!confirm(`Delete stage "${name}"? Leads in this stage will need to be reassigned.`)) return;
    try {
      await deleteStage.mutateAsync({ id });
      toast({ title: "Stage deleted" });
      invalidateStages();
    } catch (e: any) {
      toast({ title: "Failed to delete stage", description: e.message, variant: "destructive" });
    }
  };

  const openCreateRule = () => { setEditRule(null); setRuleForm(EMPTY_RULE); setRuleDialogOpen(true); };
  const openEditRule = (r: AutomationRule) => {
    setEditRule(r);
    setRuleForm({ name: r.name, trigger: r.trigger, triggerValue: r.triggerValue ?? undefined, actionType: r.actionType, actionValue: r.actionValue ?? undefined, isActive: r.isActive });
    setRuleDialogOpen(true);
  };

  const handleSaveRule = async () => {
    if (!ruleForm.name.trim()) { toast({ title: "Name required", variant: "destructive" }); return; }
    try {
      if (editRule) {
        await updateRule.mutateAsync({ id: editRule.id, data: ruleForm });
        toast({ title: "Rule updated" });
      } else {
        await createRule.mutateAsync({ data: ruleForm });
        toast({ title: "Rule created" });
      }
      setRuleDialogOpen(false);
      invalidateRules();
    } catch (e: any) {
      toast({ title: "Failed to save rule", description: e.message, variant: "destructive" });
    }
  };

  const handleDeleteRule = async (id: number) => {
    if (!confirm("Delete this automation rule?")) return;
    try {
      await deleteRule.mutateAsync({ id });
      toast({ title: "Rule deleted" });
      invalidateRules();
    } catch (e: any) {
      toast({ title: "Failed to delete", description: e.message, variant: "destructive" });
    }
  };

  const handleToggleRule = async (r: AutomationRule) => {
    try {
      await updateRule.mutateAsync({ id: r.id, data: { name: r.name, trigger: r.trigger, actionType: r.actionType, triggerValue: r.triggerValue ?? undefined, actionValue: r.actionValue ?? undefined, isActive: !r.isActive } });
      invalidateRules();
    } catch {
      toast({ title: "Failed to update rule", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">Configure your pipeline, automation, and account preferences.</p>
      </div>

      <Tabs defaultValue="profile">
        <TabsList className="mb-6">
          <TabsTrigger value="profile"><User className="h-4 w-4 mr-2" />Profile</TabsTrigger>
          <TabsTrigger value="notifications"><Bell className="h-4 w-4 mr-2" />Notifications</TabsTrigger>
          <TabsTrigger value="pipeline"><Settings2 className="h-4 w-4 mr-2" />Pipeline</TabsTrigger>
          {isAdmin && <TabsTrigger value="organisation"><Building2 className="h-4 w-4 mr-2" />Organisation</TabsTrigger>}
          {isAdmin && <TabsTrigger value="automation"><Zap className="h-4 w-4 mr-2" />Automation</TabsTrigger>}
          {isAdmin && <TabsTrigger value="email-templates"><Mail className="h-4 w-4 mr-2" />Email Templates</TabsTrigger>}
          {isAdmin && <TabsTrigger value="web-to-lead"><Link2 className="h-4 w-4 mr-2" />Web-to-Lead</TabsTrigger>}
        </TabsList>

        {/* ── Profile Tab ────────────────────────────────────────── */}
        <TabsContent value="profile" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><User className="h-5 w-5 text-primary" />Your Profile</CardTitle>
              <CardDescription>Your account information from Replit Auth. To update your name or avatar, edit your Replit profile.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-4">
                {(user as any)?.profileImage ? (
                  <img src={(user as any).profileImage} alt="Avatar" className="h-16 w-16 rounded-full object-cover ring-2 ring-border" />
                ) : (
                  <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center text-primary text-xl font-bold">
                    {((user as any)?.firstName?.[0] ?? (user as any)?.name?.[0] ?? "U").toUpperCase()}
                  </div>
                )}
                <div>
                  <p className="font-semibold text-lg">
                    {(user as any)?.firstName && (user as any)?.lastName
                      ? `${(user as any).firstName} ${(user as any).lastName}`
                      : (user as any)?.name ?? "Unknown"}
                  </p>
                  <p className="text-sm text-muted-foreground">{(user as any)?.email ?? "No email"}</p>
                  <Badge variant="outline" className="mt-1 capitalize text-xs">{(user as any)?.role ?? "member"}</Badge>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4 pt-2 border-t text-sm">
                <div>
                  <p className="text-muted-foreground text-xs uppercase tracking-wide mb-1">Role</p>
                  <p className="font-medium capitalize">{(user as any)?.role ?? "—"}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs uppercase tracking-wide mb-1">Username</p>
                  <p className="font-medium">{(user as any)?.username ?? "—"}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Notifications Tab ──────────────────────────────────── */}
        <TabsContent value="notifications" className="space-y-6">
          {notifLoading ? (
            <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : (
            <>
              {/* Master switch */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2"><Bell className="h-5 w-5 text-primary" />Email Notifications</CardTitle>
                  <CardDescription>Control which email notifications you receive. All settings are per-user and saved to your account.</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between py-1">
                    <div>
                      <p className="text-sm font-semibold">Enable email notifications</p>
                      <p className="text-xs text-muted-foreground mt-0.5">Master switch — all email alerts are off when disabled</p>
                    </div>
                    <Switch
                      checked={notifPrefs.emailNotificationsEnabled}
                      onCheckedChange={v => setNotifPrefs(p => ({ ...p, emailNotificationsEnabled: v }))}
                    />
                  </div>
                </CardContent>
              </Card>

              {/* Lead events */}
              <Card className={!notifPrefs.emailNotificationsEnabled ? "opacity-50 pointer-events-none" : ""}>
                <CardHeader>
                  <CardTitle className="text-base">Lead Events</CardTitle>
                  <CardDescription>Emails triggered by activity on leads you own or manage.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {([
                    { key: "notifyNewLead", label: "New lead assigned to you", description: "When a lead is created and assigned to your account" },
                    { key: "notifyStatusChange", label: "Pipeline stage changed", description: "When one of your leads moves to a different stage" },
                    { key: "notifyImportantFieldChange", label: "Important field updated", description: "When key fields like deal value or contact info change on your leads" },
                    { key: "notifyUrgentEscalation", label: "Urgent escalation", description: "When a lead is flagged as urgent or escalated" },
                  ] as { key: keyof typeof notifPrefs; label: string; description: string }[]).map(({ key, label, description }) => (
                    <div key={key} className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium">{label}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
                      </div>
                      <Switch
                        checked={notifPrefs[key] as boolean}
                        onCheckedChange={v => setNotifPrefs(p => ({ ...p, [key]: v }))}
                      />
                    </div>
                  ))}
                </CardContent>
              </Card>

              {/* Reminders */}
              <Card className={!notifPrefs.emailNotificationsEnabled ? "opacity-50 pointer-events-none" : ""}>
                <CardHeader>
                  <CardTitle className="text-base">Reminders</CardTitle>
                  <CardDescription>Scheduled reminders for upcoming tasks and activities.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {([
                    { key: "notifyCallReminders", label: "Call reminders", description: "Email reminders before scheduled calls" },
                    { key: "notifyMeetingTaskReminders", label: "Meeting & task reminders", description: "Email reminders before meetings and when tasks are due" },
                  ] as { key: keyof typeof notifPrefs; label: string; description: string }[]).map(({ key, label, description }) => (
                    <div key={key} className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium">{label}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
                      </div>
                      <Switch
                        checked={notifPrefs[key] as boolean}
                        onCheckedChange={v => setNotifPrefs(p => ({ ...p, [key]: v }))}
                      />
                    </div>
                  ))}
                </CardContent>
              </Card>

              {/* Team / hierarchy alerts */}
              <Card className={!notifPrefs.emailNotificationsEnabled ? "opacity-50 pointer-events-none" : ""}>
                <CardHeader>
                  <CardTitle className="text-base">Team &amp; Hierarchy Alerts</CardTitle>
                  <CardDescription>Emails about activity from your direct reports or management chain.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {([
                    { key: "notifyOnSubordinateManualLead", label: "Subordinate adds a lead", description: "When a team member you manage manually creates a new lead" },
                    { key: "notifyOnManagerActivity", label: "Manager activity", description: "When your manager updates or reassigns one of your leads" },
                    { key: "notifyOnAdminActivity", label: "Admin activity", description: "When an admin makes account-level changes that affect you" },
                  ] as { key: keyof typeof notifPrefs; label: string; description: string }[]).map(({ key, label, description }) => (
                    <div key={key} className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium">{label}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
                      </div>
                      <Switch
                        checked={notifPrefs[key] as boolean}
                        onCheckedChange={v => setNotifPrefs(p => ({ ...p, [key]: v }))}
                      />
                    </div>
                  ))}
                </CardContent>
              </Card>

              <div className="flex items-center justify-between">
                <Button
                  variant="outline"
                  onClick={handleSendTestEmail}
                  disabled={testEmailSending || !notifPrefs.emailNotificationsEnabled}
                  title={!notifPrefs.emailNotificationsEnabled ? "Enable email notifications first" : "Send a test email to your account address"}
                >
                  {testEmailSending
                    ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Sending…</>
                    : <><Mail className="mr-2 h-4 w-4" />Send test email</>}
                </Button>
                <Button variant="cta" onClick={handleSaveNotifPrefs} disabled={notifSaving}>
                  {notifSaving ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving…</> : "Save preferences"}
                </Button>
              </div>
            </>
          )}
        </TabsContent>

        {/* ── Pipeline Stages Tab ────────────────────────────────── */}
        <TabsContent value="pipeline" className="space-y-6">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Pipeline Stages</CardTitle>
                  <CardDescription className="mt-1">Define the stages leads move through in your sales process.</CardDescription>
                </div>
                <Button variant="cta" size="sm" onClick={() => setAddOpen(true)}>
                  <Plus className="mr-2 h-4 w-4" /> Add Stage
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {isLoading ? (
                <div className="flex justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <div className="divide-y">
                  {(stages || []).map((stage) => (
                    <div key={stage.id} className="flex items-center gap-3 px-6 py-3 hover:bg-muted/30 transition-colors group">
                      <GripVertical className="h-4 w-4 text-muted-foreground/40 cursor-grab" />
                      <div className="h-3 w-3 rounded-full flex-shrink-0" style={{ backgroundColor: stage.color || "#6366f1" }} />
                      <span className="flex-1 font-medium text-sm">{stage.name}</span>
                      <div className="flex items-center gap-1.5">
                        {stage.isDefault && <Badge variant="outline" className="text-xs">Default</Badge>}
                        {stage.isWon && <Badge variant="outline" className="text-xs text-green-600 border-green-200">Won</Badge>}
                        {stage.isLost && <Badge variant="outline" className="text-xs text-red-600 border-red-200">Lost</Badge>}
                      </div>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button
                          variant="ghost" size="icon" className="h-7 w-7"
                          onClick={() => setEditStage({ id: stage.id, name: stage.name, color: stage.color || "#6366f1" })}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        {!stage.isDefault && !stage.isWon && !stage.isLost && (
                          <Button
                            variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:bg-destructive/10"
                            onClick={() => handleDeleteStage(stage.id, stage.name)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Organisation Tab ───────────────────────────────────── */}
        {isAdmin && (
          <TabsContent value="organisation" className="space-y-6">
            {orgLoading ? (
              <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
            ) : (
              <>
                {/* Identity */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2"><Building2 className="h-5 w-5 text-primary" />Identity</CardTitle>
                    <CardDescription>Your company name, logo, branding, and public-facing domain.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <Label>Organisation Name</Label>
                        <Input value={orgForm.name} onChange={e => setOrgForm(f => ({ ...f, name: e.target.value }))} placeholder="Acme Corp" />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="flex items-center gap-1.5"><Globe className="h-3.5 w-3.5" />Domain</Label>
                        <Input value={orgForm.domain} onChange={e => setOrgForm(f => ({ ...f, domain: e.target.value }))} placeholder="acme.com" />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Logo URL</Label>
                      <Input value={orgForm.logoUrl} onChange={e => setOrgForm(f => ({ ...f, logoUrl: e.target.value }))} placeholder="https://acme.com/logo.png" />
                      {orgForm.logoUrl && (
                        <img src={orgForm.logoUrl} alt="Logo preview" className="h-10 mt-2 rounded object-contain border bg-muted/30 px-2" onError={e => (e.currentTarget.style.display = "none")} />
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <Label className="flex items-center gap-1.5"><Palette className="h-3.5 w-3.5" />Brand Colour</Label>
                        <div className="flex items-center gap-2">
                          <input type="color" value={orgForm.primaryColor} onChange={e => setOrgForm(f => ({ ...f, primaryColor: e.target.value }))} className="h-9 w-12 rounded border cursor-pointer bg-background p-0.5" />
                          <Input value={orgForm.primaryColor} onChange={e => setOrgForm(f => ({ ...f, primaryColor: e.target.value }))} className="font-mono text-sm" placeholder="#3b82f6" />
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <Label>Theme</Label>
                        <Select value={orgForm.theme} onValueChange={v => setOrgForm(f => ({ ...f, theme: v }))}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="system">System default</SelectItem>
                            <SelectItem value="light">Light</SelectItem>
                            <SelectItem value="dark">Dark</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Company Profile */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2"><Building2 className="h-5 w-5 text-primary" />Company Profile</CardTitle>
                    <CardDescription>Industry, business type, company size, and website — collected during setup and used in reports and exports.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <Label>Business Type</Label>
                        <Select value={orgForm.businessType || "__none__"} onValueChange={v => setOrgForm(f => ({ ...f, businessType: v === "__none__" ? "" : v }))}>
                          <SelectTrigger><SelectValue placeholder="Select type…" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">— Not specified —</SelectItem>
                            {["Technology", "Finance & Banking", "Healthcare", "Education", "Real Estate", "Manufacturing", "Retail & E-commerce", "Consulting", "Marketing & Advertising", "Logistics & Supply Chain", "Legal Services", "Non-Profit", "Media & Entertainment", "Construction", "Other"].map(t => (
                              <SelectItem key={t} value={t}>{t}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label>Number of Employees</Label>
                        <Select value={orgForm.employeeCount || "__none__"} onValueChange={v => setOrgForm(f => ({ ...f, employeeCount: v === "__none__" ? "" : v }))}>
                          <SelectTrigger><SelectValue placeholder="Select range…" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">— Not specified —</SelectItem>
                            {["1–10", "11–50", "51–200", "201–500", "500–1,000", "1,000+"].map(r => (
                              <SelectItem key={r} value={r}>{r}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <Label>Industry</Label>
                        <Input value={orgForm.industry} onChange={e => setOrgForm(f => ({ ...f, industry: e.target.value }))} placeholder="e.g. SaaS, Healthcare…" />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="flex items-center gap-1.5"><Globe className="h-3.5 w-3.5" />Website</Label>
                        <Input value={orgForm.website} onChange={e => setOrgForm(f => ({ ...f, website: e.target.value }))} placeholder="https://yourcompany.com" />
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Contact */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2"><Phone className="h-5 w-5 text-primary" />Contact Information</CardTitle>
                    <CardDescription>Business email, phone, and address used in correspondence and exports.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <Label className="flex items-center gap-1.5"><Mail className="h-3.5 w-3.5" />Business Email</Label>
                        <Input type="email" value={orgForm.businessEmail} onChange={e => setOrgForm(f => ({ ...f, businessEmail: e.target.value }))} placeholder="hello@acme.com" />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="flex items-center gap-1.5"><Phone className="h-3.5 w-3.5" />Business Phone</Label>
                        <Input value={orgForm.businessPhone} onChange={e => setOrgForm(f => ({ ...f, businessPhone: e.target.value }))} placeholder="+1 555 000 0000" />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5" />Address</Label>
                      <Textarea value={orgForm.address} onChange={e => setOrgForm(f => ({ ...f, address: e.target.value }))} placeholder="123 Main St, City, Country" rows={3} />
                    </div>
                  </CardContent>
                </Card>

                {/* Regional */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2"><Globe className="h-5 w-5 text-primary" />Regional</CardTitle>
                    <CardDescription>Default currency and timezone used across reports, exports, and date display.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <Label>Currency</Label>
                        <Select value={orgForm.currency} onValueChange={v => setOrgForm(f => ({ ...f, currency: v }))}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {["INR", "USD", "EUR", "GBP", "AUD", "CAD", "SGD", "JPY", "AED", "MYR", "NGN", "ZAR"].map(c => (
                              <SelectItem key={c} value={c}>{c}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label>Timezone</Label>
                        <Select value={orgForm.timezone} onValueChange={v => setOrgForm(f => ({ ...f, timezone: v }))}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {[
                              "UTC", "America/New_York", "America/Chicago", "America/Denver",
                              "America/Los_Angeles", "America/Sao_Paulo",
                              "Europe/London", "Europe/Paris", "Europe/Berlin",
                              "Africa/Lagos", "Africa/Johannesburg",
                              "Asia/Dubai", "Asia/Kolkata", "Asia/Singapore",
                              "Asia/Tokyo", "Asia/Kuala_Lumpur",
                              "Australia/Sydney",
                            ].map(tz => (
                              <SelectItem key={tz} value={tz}>{tz}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* SMTP */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2"><Server className="h-5 w-5 text-primary" />SMTP Configuration</CardTitle>
                    <CardDescription>Outbound email server settings for sending emails from your own domain.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-3 gap-4">
                      <div className="col-span-2 space-y-1.5">
                        <Label>SMTP Host</Label>
                        <Input value={orgForm.smtpHost} onChange={e => setOrgForm(f => ({ ...f, smtpHost: e.target.value }))} placeholder="smtp.mailprovider.com" />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Port</Label>
                        <Input value={orgForm.smtpPort} onChange={e => setOrgForm(f => ({ ...f, smtpPort: e.target.value }))} placeholder="587" />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <Label>Username</Label>
                        <Input value={orgForm.smtpUser} onChange={e => setOrgForm(f => ({ ...f, smtpUser: e.target.value }))} placeholder="smtp-user@acme.com" />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Password</Label>
                        <Input type="password" value={orgForm.smtpPass} onChange={e => setOrgForm(f => ({ ...f, smtpPass: e.target.value }))} placeholder="••••••••" />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label>From Address</Label>
                      <Input type="email" value={orgForm.smtpFrom} onChange={e => setOrgForm(f => ({ ...f, smtpFrom: e.target.value }))} placeholder="no-reply@acme.com" />
                    </div>
                  </CardContent>
                </Card>

                {/* WhatsApp */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2"><MessageSquare className="h-5 w-5 text-primary" />WhatsApp Settings</CardTitle>
                    <CardDescription>WhatsApp Business API credentials for outbound messaging to leads.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <Label>Business Name</Label>
                        <Input value={orgForm.whatsappBusinessName} onChange={e => setOrgForm(f => ({ ...f, whatsappBusinessName: e.target.value }))} placeholder="Acme Corp" />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Phone Number ID</Label>
                        <Input value={orgForm.whatsappPhoneNumberId} onChange={e => setOrgForm(f => ({ ...f, whatsappPhoneNumberId: e.target.value }))} placeholder="123456789012345" />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label>API Key</Label>
                      <Input type="password" value={orgForm.whatsappApiKey} onChange={e => setOrgForm(f => ({ ...f, whatsappApiKey: e.target.value }))} placeholder="••••••••" />
                    </div>
                  </CardContent>
                </Card>

                <div className="flex justify-end">
                  <Button variant="cta" onClick={handleSaveOrg} disabled={orgSaving}>
                    {orgSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Save Organisation Settings
                  </Button>
                </div>
              </>
            )}
          </TabsContent>
        )}

        {/* ── Automation Tab ─────────────────────────────────────── */}
        {isAdmin && (
          <TabsContent value="automation" className="space-y-6">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>Automation Rules</CardTitle>
                    <CardDescription className="mt-1">Trigger actions automatically when conditions are met.</CardDescription>
                  </div>
                  <Button variant="cta" size="sm" onClick={openCreateRule}>
                    <Plus className="mr-2 h-4 w-4" />New Rule
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {loadingRules ? (
                  <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
                ) : (rules ?? []).length === 0 ? (
                  <div className="py-12 text-center text-muted-foreground text-sm">
                    No automation rules yet. Create one to auto-assign leads or trigger follow-ups.
                  </div>
                ) : (
                  <div className="divide-y">
                    {(rules ?? []).map(rule => (
                      <div key={rule.id} className="flex items-center gap-4 px-6 py-4 hover:bg-muted/30 group">
                        <Switch checked={rule.isActive} onCheckedChange={() => handleToggleRule(rule)} />
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm truncate">{rule.name}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            When <span className="text-foreground">{TRIGGER_OPTIONS.find(t => t.value === rule.trigger)?.label ?? rule.trigger}</span>
                            {rule.triggerValue ? ` = "${rule.triggerValue}"` : ""}{" → "}
                            <span className="text-foreground">{ACTION_OPTIONS.find(a => a.value === rule.actionType)?.label ?? rule.actionType}</span>
                            {rule.actionValue ? `: "${rule.actionValue}"` : ""}
                          </p>
                        </div>
                        <Badge variant={rule.isActive ? "default" : "outline"} className="text-xs shrink-0">
                          {rule.isActive ? "Active" : "Inactive"}
                        </Badge>
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100">
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEditRule(rule)}><Pencil className="h-3.5 w-3.5" /></Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:bg-destructive/10" onClick={() => handleDeleteRule(rule.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {/* ── Email Templates Tab ────────────────────────────────── */}
        {isAdmin && (
          <TabsContent value="email-templates" className="space-y-6">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>Email Templates</CardTitle>
                    <CardDescription className="mt-1">Reusable templates available to all reps in the compose dialog. When at least one template exists here, the built-in defaults are replaced.</CardDescription>
                  </div>
                  <Button variant="cta" size="sm" onClick={openCreateEmailTpl}>
                    <Plus className="mr-2 h-4 w-4" />New Template
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {loadingEmailTemplates ? (
                  <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
                ) : (emailTemplates ?? []).length === 0 ? (
                  <div className="py-12 text-center text-muted-foreground text-sm">
                    No custom templates yet. The compose dialog currently shows the 6 built-in defaults.
                  </div>
                ) : (
                  <div className="divide-y">
                    {(emailTemplates ?? []).map(tpl => (
                      <div key={tpl.id} className="flex items-start gap-4 px-6 py-4 hover:bg-muted/30 group">
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm truncate">{tpl.name}</p>
                          <p className="text-xs text-muted-foreground mt-0.5 truncate">{tpl.subject}</p>
                          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2 whitespace-pre-wrap">{tpl.body}</p>
                        </div>
                        <Badge variant={tpl.isActive ? "default" : "outline"} className="text-xs shrink-0 mt-0.5">
                          {tpl.isActive ? "Active" : "Inactive"}
                        </Badge>
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 shrink-0">
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEditEmailTpl(tpl)}><Pencil className="h-3.5 w-3.5" /></Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:bg-destructive/10" onClick={() => handleDeleteEmailTpl(tpl.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {isAdmin && (
          <TabsContent value="web-to-lead" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Link2 className="h-5 w-5 text-primary" />Public Web-to-Lead Form</CardTitle>
                <CardDescription>Generate a private, workspace-scoped link to collect leads through the public form.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  The link routes submissions only to this workspace. Generating a new link immediately invalidates the previous one. The secret is shown only once; generate a replacement if you leave this page before saving it.
                </p>
                {webToLeadToken && (
                  <div className="flex gap-2">
                    <Input
                      aria-label="Public web-to-lead link"
                      readOnly
                      value={`${window.location.origin}/web-to-lead#token=${encodeURIComponent(webToLeadToken)}`}
                    />
                    <Button variant="outline" onClick={handleCopyWebToLeadLink}><Copy className="mr-2 h-4 w-4" />Copy</Button>
                  </div>
                )}
                <Button variant="cta" onClick={handleProvisionWebToLead} disabled={webToLeadProvisioning}>
                  {webToLeadProvisioning ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Link2 className="mr-2 h-4 w-4" />}
                  {webToLeadToken ? "Generate replacement link" : "Generate public link"}
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        )}

      </Tabs>

      {/* Stage Dialogs */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Add Pipeline Stage</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Stage Name *</Label>
              <Input value={newStage.name} onChange={(e) => setNewStage({ ...newStage, name: e.target.value })} placeholder="e.g. Qualified, Demo..." onKeyDown={(e) => e.key === "Enter" && handleAdd()} />
            </div>
            <div className="space-y-1.5">
              <Label>Color</Label>
              <div className="flex flex-wrap gap-2">
                {STAGE_COLORS.map((c) => (
                  <button key={c} type="button" className={`h-7 w-7 rounded-full border-2 transition-all ${newStage.color === c ? "border-foreground scale-110" : "border-transparent hover:border-foreground/40"}`} style={{ backgroundColor: c }} onClick={() => setNewStage({ ...newStage, color: c })} />
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button variant="cta" onClick={handleAdd} disabled={!newStage.name.trim() || createStage.isPending}>{createStage.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Add Stage</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editStage} onOpenChange={(o) => !o && setEditStage(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Edit Stage</DialogTitle></DialogHeader>
          {editStage && (
            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label>Stage Name</Label>
                <Input value={editStage.name} onChange={(e) => setEditStage({ ...editStage, name: e.target.value })} onKeyDown={(e) => e.key === "Enter" && handleEdit()} />
              </div>
              <div className="space-y-1.5">
                <Label>Color</Label>
                <div className="flex flex-wrap gap-2">
                  {STAGE_COLORS.map((c) => (
                    <button key={c} type="button" className={`h-7 w-7 rounded-full border-2 transition-all ${editStage.color === c ? "border-foreground scale-110" : "border-transparent hover:border-foreground/40"}`} style={{ backgroundColor: c }} onClick={() => setEditStage({ ...editStage, color: c })} />
                  ))}
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditStage(null)}>Cancel</Button>
            <Button variant="cta" onClick={handleEdit} disabled={!editStage?.name.trim() || updateStage.isPending}>{updateStage.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Save Changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Email Template Dialog */}
      <Dialog open={emailTplDialogOpen} onOpenChange={setEmailTplDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>{editEmailTpl ? "Edit Template" : "New Email Template"}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Template Name *</Label>
              <Input value={emailTplForm.name} onChange={e => setEmailTplForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Introduction, Follow-up…" />
            </div>
            <div className="space-y-1.5">
              <Label>Subject *</Label>
              <Input value={emailTplForm.subject} onChange={e => setEmailTplForm(f => ({ ...f, subject: e.target.value }))} placeholder="Email subject line" />
            </div>
            <div className="space-y-1.5">
              <Label>Body *</Label>
              <textarea
                className="w-full min-h-[200px] rounded-md border border-input bg-background px-3 py-2 text-sm font-mono resize-y focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={emailTplForm.body}
                onChange={e => setEmailTplForm(f => ({ ...f, body: e.target.value }))}
                placeholder="Write the email body…"
              />
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={emailTplForm.isActive !== false} onCheckedChange={v => setEmailTplForm(f => ({ ...f, isActive: v }))} />
              <Label>Active (visible in compose dialog)</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEmailTplDialogOpen(false)}>Cancel</Button>
            <Button variant="cta" onClick={handleSaveEmailTpl} disabled={createEmailTemplate.isPending || updateEmailTemplate.isPending}>
              {(createEmailTemplate.isPending || updateEmailTemplate.isPending) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {editEmailTpl ? "Save Changes" : "Create Template"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Automation Rule Dialog */}
      <Dialog open={ruleDialogOpen} onOpenChange={setRuleDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>{editRule ? "Edit Rule" : "New Automation Rule"}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Rule Name *</Label>
              <Input value={ruleForm.name} onChange={e => setRuleForm(f => ({ ...f, name: e.target.value }))} placeholder="Auto follow-up for new leads" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Trigger</Label>
                <Select value={ruleForm.trigger} onValueChange={v => setRuleForm(f => ({ ...f, trigger: v as any }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{TRIGGER_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Trigger Value (optional)</Label>
                <Input value={ruleForm.triggerValue ?? ""} onChange={e => setRuleForm(f => ({ ...f, triggerValue: e.target.value }))} placeholder="Stage name..." />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Action</Label>
                <Select value={ruleForm.actionType} onValueChange={v => setRuleForm(f => ({ ...f, actionType: v as any }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{ACTION_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Action Value (optional)</Label>
                <Input value={ruleForm.actionValue ?? ""} onChange={e => setRuleForm(f => ({ ...f, actionValue: e.target.value }))} placeholder="Notes, user ID..." />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={ruleForm.isActive !== false} onCheckedChange={v => setRuleForm(f => ({ ...f, isActive: v }))} />
              <Label>Active</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRuleDialogOpen(false)}>Cancel</Button>
            <Button variant="cta" onClick={handleSaveRule} disabled={createRule.isPending || updateRule.isPending}>
              {(createRule.isPending || updateRule.isPending) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {editRule ? "Save Changes" : "Create Rule"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
