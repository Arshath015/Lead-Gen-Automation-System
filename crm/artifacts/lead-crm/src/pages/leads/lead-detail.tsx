import { useState, useRef } from "react";
import { parseEmailNote } from "@/lib/parseEmailNote";
import { useParams, Link, useLocation } from "wouter";
import {
  useGetLead, useUpdateLead, useUpdateLeadStage, useAssignLead,
  useListNotes, useCreateNote, useUpdateNote, useDeleteNote,
  useListFollowups, useCreateFollowup, useUpdateFollowup,
  useListActivities, getListActivitiesQueryKey, useListStages, useListUsers,
  useListTags, useListAuditLogs, useListAttachments, useCreateAttachment, useDeleteAttachment,
  useListScheduledActivities, useCompleteScheduledActivity, getListScheduledActivitiesQueryKey,
  useConvertLead, useDeleteLead, type ConvertLeadBody,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { format, parseISO } from "date-fns";
import { Loader2, ArrowLeft, Mail, Phone, MapPin, Briefcase, Globe, Building2, Calendar as CalendarIcon, Clock, CheckCircle2, User, Plus, Tag, Link2, FileText, ChevronDown, Paperclip, Download, Trash2, AlertCircle, UserCircle, UserRound, Reply, Pencil, X } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { getGetLeadQueryKey, getListNotesQueryKey, getListFollowupsQueryKey, getListAttachmentsQueryKey, getListAuditLogsQueryKey } from "@workspace/api-client-react";
import { PriorityBadge, PrioritySelect } from "@/components/priority-badge";
import { EmailNoteContent } from "@/components/email-note-card";
import { TasksTab } from "./tasks-tab";
import { EmailComposeDialog } from "@/components/email-compose-dialog";
import { IndustrySelect } from "@/components/industry-select";
import { useAuth } from "@workspace/replit-auth-web";

const CHANNEL_LABELS: Record<string, string> = {
  website: "Website",
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  email: "Email",
  apollo: "Apollo",
  referral: "Referral",
  linkedin: "LinkedIn",
  database: "Database",
  other: "Other",
};

function formatFileSize(bytes: number | null | undefined) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function LeadDetail() {
  const params = useParams();
  const id = Number(params.id);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: lead, isLoading: loadingLead } = useGetLead(id, { query: { enabled: !!id, queryKey: getGetLeadQueryKey(id) } });
  const { data: notes, isLoading: loadingNotes } = useListNotes(id, { query: { enabled: !!id, queryKey: getListNotesQueryKey(id) } });
  const { data: followups, isLoading: loadingFollowups } = useListFollowups(id, undefined, { query: { enabled: !!id, queryKey: getListFollowupsQueryKey(id) } });
  const { data: activities, isLoading: loadingActivities } = useListActivities(id, { query: { enabled: !!id, queryKey: getListActivitiesQueryKey(id) } });
  const { data: scheduledActivitiesData } = useListScheduledActivities({ leadId: id, view: "all" }, { query: { enabled: !!id, queryKey: getListScheduledActivitiesQueryKey({ leadId: id, view: "all" }) } });
  const completeScheduledActivity = useCompleteScheduledActivity();
  const { data: auditLogs, isLoading: loadingAudit } = useListAuditLogs({ leadId: id }, { query: { enabled: !!id, queryKey: getListAuditLogsQueryKey({ leadId: id }) } });
  const { data: attachments, isLoading: loadingAttachments } = useListAttachments(id, { query: { enabled: !!id, queryKey: getListAttachmentsQueryKey(id) } });

  const { data: stages } = useListStages();
  const { data: users } = useListUsers();
  const { data: allTags } = useListTags();

  const [, navigate] = useLocation();
  const updateStage = useUpdateLeadStage();
  const assignLead = useAssignLead();
  const updateLead = useUpdateLead();
  const deleteLead = useDeleteLead();
  const createNote = useCreateNote();
  const updateNote = useUpdateNote();
  const deleteNote = useDeleteNote();
  const createFollowup = useCreateFollowup();
  const updateFollowup = useUpdateFollowup();
  const createAttachment = useCreateAttachment();
  const deleteAttachment = useDeleteAttachment();
  const convertLead = useConvertLead();

  const [convertOpen, setConvertOpen] = useState(false);
  const [convertForm, setConvertForm] = useState<ConvertLeadBody & { createDeal: boolean; createAccount: boolean }>({
    createDeal: true, createAccount: true,
  });
  const [convertResult, setConvertResult] = useState<{ contactId: number; accountId: number | null; dealId: number | null } | null>(null);
  const [convertDealConflict, setConvertDealConflict] = useState<{ dealId: number; dealName: string } | null>(null);

  const [editOpen, setEditOpen] = useState(false);
  const [formData, setFormData] = useState<any>({});
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [newNote, setNewNote] = useState("");
  const [noteType, setNoteType] = useState<"note" | "email" | "call">("note");
  const [followupOpen, setFollowupOpen] = useState(false);
  const [followupData, setFollowupData] = useState({ scheduledAt: "", notes: "" });
  const [uploadingFile, setUploadingFile] = useState(false);
  const [deleteAttachmentId, setDeleteAttachmentId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState("notes");
  const [emailDialogOpen, setEmailDialogOpen] = useState(false);
  const [emailInitialValues, setEmailInitialValues] = useState<{ to?: string; subject?: string; body?: string } | undefined>(undefined);
  const [expandedEmailActivities, setExpandedEmailActivities] = useState<Set<number>>(new Set());
  const [editServerError, setEditServerError] = useState("");
  const { user: authUser } = useAuth();

  const [deleteLeadOpen, setDeleteLeadOpen] = useState(false);
  const [editNoteId, setEditNoteId] = useState<number | null>(null);
  const [editNoteContent, setEditNoteContent] = useState("");
  const [deleteNoteId, setDeleteNoteId] = useState<number | null>(null);
  const [editFollowupId, setEditFollowupId] = useState<number | null>(null);
  const [editFollowupForm, setEditFollowupForm] = useState({ scheduledAt: "", notes: "" });
  const [rescheduleFollowupId, setRescheduleFollowupId] = useState<number | null>(null);
  const [rescheduleScheduledAt, setRescheduleScheduledAt] = useState("");

  const invalidateFollowupClassificationQueries = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: getGetLeadQueryKey(id) }),
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] }),
      queryClient.invalidateQueries({
        predicate: (query) => {
          const rootKey = query.queryKey[0];
          return typeof rootKey === "string" && rootKey.startsWith("/api/dashboard");
        },
      }),
    ]);
  };

  if (loadingLead) {
    return <div className="h-full w-full flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  if (!lead) {
    return <div>Lead not found</div>;
  }

  const leadAny = lead as any;
  const currentOwner = users?.find(u => u.id === lead.ownerId);

  const handleStageChange = async (stageId: number) => {
    try {
      await updateStage.mutateAsync({ id, data: { stageId } });
      queryClient.invalidateQueries({ queryKey: getGetLeadQueryKey(id) });
      queryClient.invalidateQueries({ queryKey: getListActivitiesQueryKey(id) });
      toast({ title: "Stage updated" });
    } catch {
      toast({ title: "Failed to update stage", variant: "destructive" });
    }
  };

  const handleAssign = async (ownerId: number | null) => {
    try {
      await assignLead.mutateAsync({ id, data: { ownerId } });
      queryClient.invalidateQueries({ queryKey: getGetLeadQueryKey(id) });
      queryClient.invalidateQueries({ queryKey: getListActivitiesQueryKey(id) });
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      toast({ title: "Owner updated" });
    } catch {
      toast({ title: "Failed to update owner", variant: "destructive" });
    }
  };

  const validateForm = () => {
    const errors: Record<string, string> = {};
    if (!formData.companyName?.trim()) errors.companyName = "Company name is required";
    if (!formData.contactPerson?.trim()) errors.contactPerson = "Contact person is required";
    if (formData.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) errors.email = "Invalid email format";
    if (formData.websiteUrl && !/^https?:\/\/.+/.test(formData.websiteUrl)) errors.websiteUrl = "URL must start with http:// or https://";
    if (formData.linkedinUrl && !/^https?:\/\/.+/.test(formData.linkedinUrl)) errors.linkedinUrl = "URL must start with http:// or https://";
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSaveDetails = async () => {
    setEditServerError("");
    if (!validateForm()) return;
    try {
      // Build an explicit payload containing ONLY the fields shown in the Edit
      // Details form.  Spreading the full lead object (the old approach) sent
      // incompatible null values for `ownerId` and `nextFollowUpAt` (schema is
      // .optional(), not .nullish()) causing a blanket HTTP 400 on any lead
      // where those fields were null.
      const payload: Record<string, unknown> = {
        companyName:      formData.companyName,
        contactPerson:    formData.contactPerson,
        email:            formData.email       || undefined,
        phone:            formData.phone       || undefined,
        location:         formData.location    || undefined,
        designation:      formData.designation || undefined,
        industry:         formData.industry    || null,
        linkedinUrl:      formData.linkedinUrl || undefined,
        websiteUrl:       formData.websiteUrl  || undefined,
        remarks:          formData.remarks     || undefined,
        comment:          formData.comment     || undefined,
        priority:         formData.priority    ?? null,
        channel:          formData.channel     ?? null,
        // valueAmount lives on the Lead entity (pre-sale estimate). Sending it
        // as a string matches UpdateLeadBody: z.string().nullish().
        valueAmount:      formData.valueAmount != null && formData.valueAmount !== ""
                            ? String(formData.valueAmount)
                            : null,
        currency:         formData.currency    || undefined,
        expectedCloseDate: formData.expectedCloseDate || null,
        tagIds:           formData.tagIds ?? [],
        // NOTE: stageId and ownerId are intentionally excluded — those are
        // changed via their own dedicated handlers (handleStageChange /
        // handleAssign), not via this form.
      };
      await updateLead.mutateAsync({ id, data: payload as any });
      queryClient.invalidateQueries({ queryKey: getGetLeadQueryKey(id) });
      queryClient.invalidateQueries({ queryKey: getListActivitiesQueryKey(id) });
      setEditOpen(false);
      setEditServerError("");
      toast({ title: "Lead updated" });
    } catch (e: any) {
      setEditServerError(e.message ?? "An unexpected error occurred. Please try again.");
    }
  };

  const handleAddNote = async () => {
    if (!newNote.trim()) return;
    try {
      await createNote.mutateAsync({ leadId: id, data: { content: newNote, type: noteType } as any });
      setNewNote("");
      setNoteType("note");
      queryClient.invalidateQueries({ queryKey: getListNotesQueryKey(id) });
      queryClient.invalidateQueries({ queryKey: getListActivitiesQueryKey(id) });
      toast({ title: "Note added" });
    } catch {
      toast({ title: "Failed to add note", variant: "destructive" });
    }
  };

  const handleAddFollowup = async () => {
    try {
      // Convert the datetime-local string (which is in browser-local time) to a
      // proper UTC ISO string.  Without this, a bare "YYYY-MM-DDTHH:MM" string
      // sent to the server is interpreted as UTC, producing a 5h30m shift for
      // IST users.  new Date(localString) in the browser reads it as local time;
      // .toISOString() emits the correct UTC equivalent.
      const scheduledAtUtc = new Date(followupData.scheduledAt).toISOString();
      await createFollowup.mutateAsync({ leadId: id, data: { ...followupData, scheduledAt: scheduledAtUtc } });
      setFollowupOpen(false);
      setFollowupData({ scheduledAt: "", notes: "" });
      queryClient.invalidateQueries({ queryKey: getListFollowupsQueryKey(id) });
      queryClient.invalidateQueries({ queryKey: getListActivitiesQueryKey(id) });
      await invalidateFollowupClassificationQueries();
      toast({ title: "Follow-up scheduled" });
    } catch {
      toast({ title: "Failed to schedule follow-up", variant: "destructive" });
    }
  };

  const handleSaveNote = async (noteId: number) => {
    if (!editNoteContent.trim()) return;
    try {
      await updateNote.mutateAsync({ id: noteId, data: { content: editNoteContent } });
      queryClient.invalidateQueries({ queryKey: getListNotesQueryKey(id) });
      setEditNoteId(null);
      toast({ title: "Note updated" });
    } catch {
      toast({ title: "Failed to update note", variant: "destructive" });
    }
  };

  const handleDeleteNote = async () => {
    if (!deleteNoteId) return;
    try {
      await deleteNote.mutateAsync({ id: deleteNoteId });
      queryClient.invalidateQueries({ queryKey: getListNotesQueryKey(id) });
      setDeleteNoteId(null);
      toast({ title: "Note deleted" });
    } catch {
      toast({ title: "Failed to delete note", variant: "destructive" });
    }
  };

  const handleConfirmReschedule = async () => {
    if (!rescheduleFollowupId || !rescheduleScheduledAt) return;
    try {
      // Same local→UTC conversion as create/edit: datetime-local gives a local-time
      // string; new Date() in the browser reads it as local, .toISOString() emits UTC.
      const scheduledAtUtc = new Date(rescheduleScheduledAt).toISOString();
      await updateFollowup.mutateAsync({
        id: rescheduleFollowupId,
        data: { scheduledAt: scheduledAtUtc, status: "pending" },
      });
      queryClient.invalidateQueries({ queryKey: getListFollowupsQueryKey(id) });
      await invalidateFollowupClassificationQueries();
      setRescheduleFollowupId(null);
      setRescheduleScheduledAt("");
      toast({ title: "Follow-up rescheduled" });
    } catch {
      toast({ title: "Failed to reschedule follow-up", variant: "destructive" });
    }
  };

  const handleSaveEditFollowup = async () => {
    if (!editFollowupId || !editFollowupForm.scheduledAt) return;
    try {
      // Same UTC conversion as handleAddFollowup — the edit form pre-populates
      // using local time (already fixed), so we must convert back to UTC on save.
      const scheduledAtUtc = new Date(editFollowupForm.scheduledAt).toISOString();
      await updateFollowup.mutateAsync({ id: editFollowupId, data: { scheduledAt: scheduledAtUtc, notes: editFollowupForm.notes } });
      queryClient.invalidateQueries({ queryKey: getListFollowupsQueryKey(id) });
      await invalidateFollowupClassificationQueries();
      setEditFollowupId(null);
      toast({ title: "Follow-up updated" });
    } catch {
      toast({ title: "Failed to update follow-up", variant: "destructive" });
    }
  };

  const handleFollowupStatus = async (followupId: number, status: "completed" | "cancelled" | "missed") => {
    try {
      await updateFollowup.mutateAsync({ id: followupId, data: { status } });
      queryClient.invalidateQueries({ queryKey: getListFollowupsQueryKey(id) });
      await invalidateFollowupClassificationQueries();
      toast({ title: `Follow-up ${status}` });
    } catch {
      toast({ title: `Failed to mark follow-up ${status}`, variant: "destructive" });
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast({ title: "File too large", description: "Maximum file size is 5 MB", variant: "destructive" });
      return;
    }
    setUploadingFile(true);
    try {
      const reader = new FileReader();
      reader.onload = async () => {
        const fileData = reader.result as string;
        await createAttachment.mutateAsync({
          leadId: id,
          data: {
            fileName: file.name,
            fileSize: file.size,
            mimeType: file.type,
            fileData,
          },
        });
        queryClient.invalidateQueries({ queryKey: getListAttachmentsQueryKey(id) });
        toast({ title: "File uploaded" });
        setUploadingFile(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
      };
      reader.onerror = () => {
        toast({ title: "Failed to read file", variant: "destructive" });
        setUploadingFile(false);
      };
      reader.readAsDataURL(file);
    } catch {
      toast({ title: "Failed to upload file", variant: "destructive" });
      setUploadingFile(false);
    }
  };

  const handleDownload = (attachment: any) => {
    if (!attachment.fileData) return;
    const a = document.createElement("a");
    a.href = attachment.fileData;
    a.download = attachment.fileName;
    a.click();
  };

  const handleDeleteAttachment = async () => {
    if (!deleteAttachmentId) return;
    try {
      await deleteAttachment.mutateAsync({ id: deleteAttachmentId });
      queryClient.invalidateQueries({ queryKey: getListAttachmentsQueryKey(id) });
      toast({ title: "Attachment deleted" });
      setDeleteAttachmentId(null);
    } catch {
      toast({ title: "Failed to delete attachment", variant: "destructive" });
    }
  };

  const openEdit = () => {
    setFormErrors({});
    setFormData({
      ...lead,
      priority: leadAny.priority ?? null,
      channel: leadAny.channel ?? null,
      tagIds: leadAny.tags?.map((t: any) => t.id) ?? [],
    });
    setEditOpen(true);
  };

  const toggleTagInForm = (tagId: number) => {
    setFormData((f: any) => {
      const ids: number[] = f.tagIds ?? [];
      return { ...f, tagIds: ids.includes(tagId) ? ids.filter((i: number) => i !== tagId) : [...ids, tagId] };
    });
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6 pb-10">
      {/* Header */}
      <div className="flex items-center gap-4 flex-wrap">
        <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full shrink-0" onClick={() => window.history.back()}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold tracking-tight truncate">{lead.companyName}</h1>
            <PriorityBadge priority={leadAny.priority} />
          </div>
          <p className="text-muted-foreground text-sm">
            {lead.contactPerson}{lead.designation ? ` — ${lead.designation}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          <Select value={lead.stageId.toString()} onValueChange={(v) => handleStageChange(Number(v))}>
            <SelectTrigger className="w-[170px] h-9" style={{ backgroundColor: `${lead.stageColor}15`, color: lead.stageColor || "inherit", borderColor: `${lead.stageColor}30` }}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {stages?.map((s) => (
                <SelectItem key={s.id} value={s.id.toString()}>{s.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {lead.email && (
            <Button variant="outline" size="sm" onClick={() => setEmailDialogOpen(true)}>
              <Mail className="h-4 w-4 mr-1.5" />Send Email
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={openEdit}>Edit Details</Button>
          <Button size="sm" variant="secondary" onClick={() => { setConvertForm({ createDeal: true, createAccount: true }); setConvertResult(null); setConvertDealConflict(null); setConvertOpen(true); }}>
            <UserRound className="mr-1.5 h-4 w-4" />Convert
          </Button>
          <Button size="sm" variant="outline" className="text-destructive border-destructive/30 hover:bg-destructive/10" onClick={() => setDeleteLeadOpen(true)}>
            <Trash2 className="mr-1.5 h-4 w-4" />Delete
          </Button>
        </div>
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        {/* LEFT COLUMN — sticky */}
        <div className="lg:col-span-1 space-y-5 lg:sticky lg:top-6">
          {/* Contact Info */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Contact Info</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {lead.email && (
                <div className="flex items-start gap-3">
                  <Mail className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                  <div className="text-sm break-all">{lead.email}</div>
                </div>
              )}
              {lead.phone && (
                <div className="flex items-start gap-3">
                  <Phone className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                  <div className="text-sm">{lead.phone}</div>
                </div>
              )}
              {lead.location && (
                <div className="flex items-start gap-3">
                  <MapPin className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                  <div className="text-sm">{lead.location}</div>
                </div>
              )}
              {lead.industry && (
                <div className="flex items-start gap-3">
                  <Building2 className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                  <div className="text-sm">{lead.industry}</div>
                </div>
              )}
              {lead.websiteUrl && (
                <div className="flex items-start gap-3">
                  <Globe className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                  <a href={lead.websiteUrl} target="_blank" rel="noreferrer" className="text-sm text-primary hover:underline truncate">
                    {lead.websiteUrl}
                  </a>
                </div>
              )}
              {leadAny.linkedinUrl && (
                <div className="flex items-start gap-3">
                  <Link2 className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                  <a href={leadAny.linkedinUrl} target="_blank" rel="noreferrer" className="text-sm text-primary hover:underline">LinkedIn</a>
                </div>
              )}
              {leadAny.remarks && (
                <div className="flex items-start gap-3">
                  <FileText className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                  <div className="text-sm text-muted-foreground">
                    <span className="text-xs text-muted-foreground/70 block">Remark</span>
                    {leadAny.remarks}
                  </div>
                </div>
              )}
              {leadAny.comment && (
                <div className="flex items-start gap-3">
                  <FileText className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                  <div className="text-sm text-muted-foreground">
                    <span className="text-xs text-muted-foreground/70 block">Comment</span>
                    {leadAny.comment}
                  </div>
                </div>
              )}
              {leadAny.channel && (
                <div className="flex items-start gap-3">
                  <Briefcase className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                  <div className="text-sm">
                    <span className="text-muted-foreground text-xs mr-1">Source:</span>
                    {CHANNEL_LABELS[leadAny.channel] ?? leadAny.channel}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Tags */}
          {leadAny.tags?.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                  <Tag className="h-3.5 w-3.5" /> Tags
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {leadAny.tags.map((tag: any) => (
                    <Badge key={tag.id} variant="outline" style={{ backgroundColor: `${tag.color}15`, color: tag.color, borderColor: `${tag.color}40` }}>
                      {tag.name}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Owner / Assignment */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Owner</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {currentOwner ? (
                <div className="flex items-center gap-2 mb-3">
                  <Avatar className="h-7 w-7">
                    <AvatarFallback className="text-xs bg-primary/10 text-primary">
                      {currentOwner.username?.charAt(0).toUpperCase() ?? "U"}
                    </AvatarFallback>
                  </Avatar>
                  <span className="text-sm font-medium">{currentOwner.username}</span>
                </div>
              ) : (
                <div className="flex items-center gap-2 mb-3 text-muted-foreground">
                  <UserCircle className="h-5 w-5" />
                  <span className="text-sm">Unassigned</span>
                </div>
              )}
              <Select value={lead.ownerId?.toString() || "unassigned"} onValueChange={(v) => handleAssign(v === "unassigned" ? null : Number(v))}>
                <SelectTrigger className="w-full h-8 text-xs">
                  <SelectValue placeholder="Assign to..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unassigned">Unassigned</SelectItem>
                  {users?.map(u => (
                    <SelectItem key={u.id} value={u.id.toString()}>{u.username}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardContent>
          </Card>

          {/* Created By / Date */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Created</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {leadAny.createdByName && (
                <div className="flex items-center gap-2">
                  <User className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="text-sm">{leadAny.createdByName}</span>
                </div>
              )}
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="text-sm text-muted-foreground">
                  {leadAny.createdAt ? format(parseISO(leadAny.createdAt), "MMM d, yyyy") : "—"}
                </span>
              </div>
              {lead.lostAt && (
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="text-sm text-muted-foreground">
                    Last moved to Lost: {new Intl.DateTimeFormat("en-IN", {
                      dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata",
                    }).format(parseISO(lead.lostAt))} IST
                  </span>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* RIGHT COLUMN — tabbed activity area */}
        <div className="lg:col-span-2">
          {/* Quick action row */}
          <div className="flex items-center gap-2 mb-4">
            <Button size="sm" variant="outline" onClick={() => { setActiveTab("notes"); }}>
              <Plus className="h-3.5 w-3.5 mr-1.5" /> Add Note
            </Button>
            <Button size="sm" variant="outline" onClick={() => { setFollowupOpen(true); }}>
              <CalendarIcon className="h-3.5 w-3.5 mr-1.5" /> Schedule Follow-up
            </Button>
          </div>

          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="w-full justify-start border-b rounded-none h-auto p-0 bg-transparent overflow-x-auto flex-nowrap">
              {[
                { value: "notes", label: "Notes" },
                { value: "tasks", label: "Tasks" },
                { value: "followups", label: "Follow-ups" },
                { value: "attachments", label: "Files" },
                { value: "activity", label: "Activity" },
                { value: "audit", label: "Audit History" },
              ].map(t => (
                <TabsTrigger key={t.value} value={t.value} className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent py-3 px-4 text-sm shrink-0">
                  {t.label}
                </TabsTrigger>
              ))}
            </TabsList>

            {/* Notes Tab */}
            <TabsContent value="notes" className="pt-5 m-0 space-y-5">
              <div className="space-y-3">
                <div className="flex gap-2">
                  {(["note", "email", "call"] as const).map(t => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setNoteType(t)}
                      className={`px-3 py-1.5 rounded-md text-sm font-medium border transition-colors ${noteType === t ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted"}`}
                    >
                      {t === "note" ? "📝 Note" : t === "email" ? "✉️ Log Email" : "📞 Log Call"}
                    </button>
                  ))}
                </div>
                <Textarea
                  placeholder={noteType === "email" ? "Describe the email you sent or received..." : noteType === "call" ? "Summarise the call..." : "Add a note about this lead..."}
                  className="min-h-[100px] resize-none"
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                />
                <div className="flex justify-end">
                  <Button onClick={handleAddNote} disabled={createNote.isPending || !newNote.trim()} size="sm">
                    {createNote.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : noteType === "email" ? "Log Email" : noteType === "call" ? "Log Call" : "Save Note"}
                  </Button>
                </div>
              </div>
              <div className="space-y-3">
                {loadingNotes ? (
                  <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
                ) : notes?.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8 text-sm">No notes yet. Write the first one above.</p>
                ) : (
                  notes?.map((note) => {
                    const isEmail = note.type === "email";
                    const parsedEmail = isEmail ? parseEmailNote(note.content) : null;
                    const isEditing = editNoteId === note.id;
                    const wasEdited = Math.abs(new Date((note as any).updatedAt).getTime() - new Date(note.createdAt).getTime()) > 2000;

                    const TYPE_LABELS: Record<string, string> = { note: "Note", email: "Email", call: "Call" };
                    const TYPE_COLORS: Record<string, string> = {
                      note: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
                      email: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
                      call: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",
                    };

                    return (
                      <Card key={note.id}>
                        <CardContent className="p-4 space-y-3">
                          {/* Header: type badge */}
                          <div className="flex items-center justify-between gap-2">
                            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${TYPE_COLORS[note.type ?? "note"] ?? TYPE_COLORS.note}`}>
                              {note.type === "email" ? "✉️" : note.type === "call" ? "📞" : "📝"} {TYPE_LABELS[note.type ?? "note"] ?? "Note"}
                            </span>
                            {!isEditing && (
                              <div className="flex items-center gap-1">
                                <Button
                                  variant="ghost" size="icon"
                                  className="h-7 w-7 text-muted-foreground hover:text-foreground"
                                  onClick={() => { setEditNoteId(note.id); setEditNoteContent(note.content); }}
                                  title="Edit note"
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </Button>
                                <Button
                                  variant="ghost" size="icon"
                                  className="h-7 w-7 text-muted-foreground hover:text-destructive"
                                  onClick={() => setDeleteNoteId(note.id)}
                                  title="Delete note"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            )}
                          </div>

                          {/* Content area */}
                          {isEditing ? (
                            <div className="space-y-2">
                              <Textarea
                                className="min-h-[80px] resize-none text-sm"
                                value={editNoteContent}
                                onChange={(e) => setEditNoteContent(e.target.value)}
                                autoFocus
                              />
                              <div className="flex justify-end gap-2">
                                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setEditNoteId(null)}>
                                  <X className="h-3 w-3 mr-1" />Cancel
                                </Button>
                                <Button size="sm" className="h-7 text-xs" onClick={() => handleSaveNote(note.id)} disabled={updateNote.isPending || !editNoteContent.trim()}>
                                  {updateNote.isPending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : null}Save
                                </Button>
                              </div>
                            </div>
                          ) : isEmail && parsedEmail ? (
                            <>
                              <div className="flex items-start gap-3">
                                <div className="mt-0.5 h-8 w-8 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center shrink-0">
                                  <Mail className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                                </div>
                                <EmailNoteContent parsedEmail={parsedEmail} />
                              </div>
                              <div className="flex justify-end">
                                <Button
                                  variant="ghost" size="sm"
                                  className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                                  onClick={() => {
                                    const quotedBody = parsedEmail.body
                                      ? `\n\n---\n${parsedEmail.body.split("\n").map((l) => `> ${l}`).join("\n")}`
                                      : "";
                                    setEmailInitialValues({
                                      to: parsedEmail.to,
                                      subject: parsedEmail.subject.startsWith("Re:") ? parsedEmail.subject : `Re: ${parsedEmail.subject}`,
                                      body: quotedBody,
                                    });
                                    setEmailDialogOpen(true);
                                  }}
                                >
                                  <Reply className="h-3.5 w-3.5 mr-1" />Reply
                                </Button>
                              </div>
                            </>
                          ) : (
                            <p className="text-sm whitespace-pre-wrap">{note.content}</p>
                          )}

                          {/* Footer: avatar, name, date, edited badge */}
                          {!isEditing && (
                            <div className="flex items-center gap-2 text-xs text-muted-foreground pt-1 border-t border-border/50">
                              <Avatar className="h-5 w-5">
                                <AvatarFallback className="text-[10px]">{note.createdByName?.charAt(0) || "U"}</AvatarFallback>
                              </Avatar>
                              <span className="font-medium text-foreground/70">{note.createdByName || "Unknown"}</span>
                              <span>&middot;</span>
                              <span>{format(parseISO(note.createdAt), "MMM d, yyyy 'at' h:mm a")}</span>
                              {wasEdited && (
                                <span className="ml-auto inline-flex items-center gap-1 text-[10px] bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 px-1.5 py-0.5 rounded border border-amber-200 dark:border-amber-700/40">
                                  <Pencil className="h-2.5 w-2.5" />Edited
                                </span>
                              )}
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    );
                  })
                )}
              </div>
            </TabsContent>

            {/* Tasks Tab */}
            <TabsContent value="tasks" className="pt-5 m-0">
              <TasksTab leadId={id} />
            </TabsContent>

            {/* Follow-ups Tab */}
            <TabsContent value="followups" className="pt-5 m-0 space-y-5">
              <div className="flex justify-between items-center">
                <h3 className="text-base font-medium">Scheduled Follow-ups</h3>
                <Button variant="cta" size="sm" onClick={() => setFollowupOpen(true)}>
                  <Plus className="h-4 w-4 mr-2" /> Schedule
                </Button>
              </div>
              <div className="space-y-3">
                {loadingFollowups ? (
                  <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
                ) : followups?.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8 text-sm">No follow-ups scheduled. Add the first one!</p>
                ) : (
                  followups?.map((f) => {
                    const isOverdue = f.status === "pending" && new Date(f.scheduledAt) < new Date();
                    const displayStatus = isOverdue ? "overdue" : f.status;
                    const statusColors: Record<string, string> = {
                      completed: "bg-green-100 text-green-700 dark:bg-green-900/30",
                      cancelled: "bg-muted text-muted-foreground",
                      overdue: "bg-red-100 text-red-600 dark:bg-red-900/30",
                      missed: "bg-red-100 text-red-600 dark:bg-red-900/30",
                      rescheduled: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30",
                      pending: "bg-primary/10 text-primary",
                    };
                    const badgeColors: Record<string, string> = {
                      completed: "border-green-300 text-green-700 bg-green-50",
                      cancelled: "border-muted text-muted-foreground bg-muted/30",
                      overdue: "border-red-300 text-red-600 bg-red-50",
                      missed: "border-red-300 text-red-600 bg-red-50",
                      rescheduled: "border-yellow-300 text-yellow-700 bg-yellow-50",
                      pending: "border-primary/30 text-primary bg-primary/5",
                    };
                    return (
                      <Card key={f.id} className={`${f.status === "completed" || f.status === "cancelled" ? "opacity-60 bg-muted/50" : ""} ${isOverdue ? "border-red-200" : ""}`}>
                        <CardContent className="p-4 flex items-start gap-4">
                          <div className={`mt-0.5 h-8 w-8 rounded-full flex items-center justify-center shrink-0 ${statusColors[displayStatus] ?? "bg-muted text-muted-foreground"}`}>
                            {f.status === "completed" ? <CheckCircle2 className="h-4 w-4" /> :
                             isOverdue ? <AlertCircle className="h-4 w-4" /> :
                             f.status === "missed" ? <AlertCircle className="h-4 w-4" /> :
                             <CalendarIcon className="h-4 w-4" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-2 flex-wrap">
                              <p className={`font-medium text-sm ${f.status === "completed" || f.status === "cancelled" ? "line-through text-muted-foreground" : ""}`}>
                                {format(parseISO(f.scheduledAt), "EEEE, MMM d, yyyy 'at' h:mm a")}
                              </p>
                              <div className="flex items-center gap-2">
                                <Badge variant="outline" className={`text-xs capitalize ${badgeColors[displayStatus] ?? ""}`}>
                                  {displayStatus}
                                </Badge>
                                {/* Complete — only for pending/overdue */}
                                {f.status === "pending" && (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-7 text-xs border-green-300 text-green-700 hover:bg-green-50"
                                    onClick={() => handleFollowupStatus(f.id, "completed")}
                                  >
                                    <CheckCircle2 className="h-3 w-3 mr-1" /> Complete
                                  </Button>
                                )}
                                {/* Terminal follow-ups remain in history; only active rows have actions. */}
                                {f.status !== "completed" && f.status !== "cancelled" && (
                                  <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                      <Button variant="ghost" size="sm" className="h-7 text-xs gap-1">
                                        <ChevronDown className="h-3 w-3" />
                                      </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end">
                                      <DropdownMenuItem onClick={() => {
                                        const d = new Date(f.scheduledAt);
                                        const pad = (n: number) => String(n).padStart(2, "0");
                                        const localDt = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
                                        setEditFollowupForm({ scheduledAt: localDt, notes: (f as any).notes ?? "" });
                                        setEditFollowupId(f.id);
                                      }}>
                                        <Pencil className="h-3.5 w-3.5 mr-2" />Edit
                                      </DropdownMenuItem>
                                      <DropdownMenuItem onClick={() => {
                                        const d = new Date(f.scheduledAt);
                                        const pad = (n: number) => String(n).padStart(2, "0");
                                        const localDt = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
                                        setRescheduleScheduledAt(localDt);
                                        setRescheduleFollowupId(f.id);
                                      }}>
                                        🔄 Reschedule
                                      </DropdownMenuItem>
                                      {f.status === "pending" && (
                                        <DropdownMenuItem onClick={() => handleFollowupStatus(f.id, "missed")}>
                                          ❌ Mark Missed
                                        </DropdownMenuItem>
                                      )}
                                      {f.status === "pending" && (
                                        <DropdownMenuItem onClick={() => handleFollowupStatus(f.id, "cancelled")}>
                                          <X className="h-3.5 w-3.5 mr-2" />Cancel follow-up
                                        </DropdownMenuItem>
                                      )}
                                    </DropdownMenuContent>
                                  </DropdownMenu>
                                )}
                              </div>
                            </div>
                            {f.notes && <p className="text-sm mt-1 text-muted-foreground">{f.notes}</p>}
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })
                )}
              </div>
            </TabsContent>

            {/* Attachments Tab */}
            <TabsContent value="attachments" className="pt-5 m-0 space-y-5">
              <div className="flex justify-between items-center">
                <h3 className="text-base font-medium">Attachments</h3>
                <div>
                  <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileUpload} />
                  <Button variant="cta" size="sm" onClick={() => fileInputRef.current?.click()} disabled={uploadingFile}>
                    {uploadingFile ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />}
                    Upload File
                  </Button>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">Max file size: 5 MB. Supported: any file type.</p>
              {loadingAttachments ? (
                <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
              ) : !attachments?.length ? (
                <div className="flex flex-col items-center justify-center py-12 border-2 border-dashed rounded-lg text-center">
                  <Paperclip className="h-8 w-8 text-muted-foreground mb-2" />
                  <p className="text-sm text-muted-foreground">No attachments yet.</p>
                  <p className="text-xs text-muted-foreground mt-1">Click Upload File to add the first one.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {attachments.map((a) => (
                    <div key={a.id} className="flex items-center gap-3 p-3 border rounded-lg hover:bg-muted/30 transition-colors">
                      <Paperclip className="h-4 w-4 text-muted-foreground shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{a.fileName}</p>
                        <p className="text-xs text-muted-foreground">
                          {a.uploadedByName && `${a.uploadedByName} · `}
                          {a.fileSize ? formatFileSize(a.fileSize) + " · " : ""}
                          {format(parseISO(a.createdAt), "MMM d, yyyy")}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleDownload(a)} aria-label={`Download ${a.fileName}`}>
                          <Download className="h-3.5 w-3.5" aria-hidden="true" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => setDeleteAttachmentId(a.id)} aria-label={`Delete ${a.fileName}`}>
                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>

            {/* Activity Tab */}
            <TabsContent value="activity" className="pt-5 m-0 space-y-6">
              {/* Scheduled Activities for this lead */}
              {(scheduledActivitiesData?.activities?.length ?? 0) > 0 && (
                <div className="space-y-2">
                  <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Scheduled Activities</h4>
                  {scheduledActivitiesData!.activities.map((sa: any) => (
                    <div key={sa.id} className={`flex items-start gap-3 p-3 rounded-lg border
                      ${sa.status === "overdue" ? "border-red-300 bg-red-50/50 dark:bg-red-950/20" : "border-border bg-card"}`}>
                      <div className="mt-0.5">
                        {sa.status === "completed"
                          ? <CheckCircle2 className="h-5 w-5 text-green-500" />
                          : sa.status === "overdue"
                          ? <AlertCircle className="h-5 w-5 text-red-500" />
                          : <div className="h-5 w-5 rounded-full border-2 border-muted-foreground" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium capitalize">{sa.type}</span>
                          <span className="text-sm">{sa.subject}</span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {format(parseISO(sa.dueAt), "MMM d, yyyy h:mm a")}
                          {sa.ownerName && <span> · {sa.ownerName}</span>}
                        </p>
                      </div>
                      {sa.status !== "completed" && (
                        <Button size="sm" variant="ghost" className="h-7 text-xs"
                          onClick={async () => {
                            await completeScheduledActivity.mutateAsync({ id: sa.id });
                            queryClient.invalidateQueries({ queryKey: ["/api/scheduled-activities"] });
                          }}>
                          Done
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Timeline */}
              <div className="relative border-l ml-3 pl-6 space-y-8 py-2">
                {loadingActivities ? (
                  <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
                ) : !activities?.length ? (
                  <p className="text-center text-muted-foreground py-8 text-sm">No activity recorded yet.</p>
                ) : (
                  activities.map((activity) => {
                    const isEmailActivity = activity.type === "note_added" && activity.newValue?.startsWith("email:");
                    if (isEmailActivity) {
                      const noteId = parseInt(activity.newValue!.split(":")[1]);
                      const emailNote = notes?.find((n: any) => n.id === noteId);
                      const parsed = emailNote ? parseEmailNoteContent(emailNote.content) : null;
                      const isExpanded = expandedEmailActivities.has(activity.id);
                      return (
                        <div key={activity.id} className="relative">
                          <div className="absolute -left-[35px] bg-background border rounded-full p-1.5 shadow-sm">
                            <Mail className="h-3.5 w-3.5 text-blue-500" />
                          </div>
                          <div className="flex flex-col gap-1">
                            <p className="text-sm">
                              <span className="font-medium">{activity.userName || "System"}</span>{" "}
                              <span className="text-muted-foreground">sent an email</span>
                            </p>
                            <div className="mt-1 rounded-lg border bg-muted/30 overflow-hidden">
                              <button
                                className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left hover:bg-muted/50 transition-colors"
                                onClick={() => setExpandedEmailActivities(prev => {
                                  const next = new Set(prev);
                                  if (next.has(activity.id)) next.delete(activity.id);
                                  else next.add(activity.id);
                                  return next;
                                })}
                              >
                                <div className="flex items-center gap-2 min-w-0">
                                  <Mail className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                  <span className="text-xs font-medium truncate">
                                    {parsed?.subject ?? activity.description}
                                  </span>
                                  {parsed?.to && (
                                    <span className="text-xs text-muted-foreground truncate hidden sm:inline">
                                      → {parsed.to}
                                    </span>
                                  )}
                                </div>
                                <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                              </button>
                              {isExpanded && (
                                <div className="px-3 pb-3 pt-1 border-t">
                                  {parsed?.to && (
                                    <p className="text-xs text-muted-foreground mb-1"><span className="font-medium">To:</span> {parsed.to}</p>
                                  )}
                                  {parsed?.subject && (
                                    <p className="text-xs text-muted-foreground mb-2"><span className="font-medium">Subject:</span> {parsed.subject}</p>
                                  )}
                                  <p className="text-xs whitespace-pre-wrap text-foreground/80">
                                    {parsed?.body ?? (emailNote ? emailNote.content : "Content unavailable")}
                                  </p>
                                  <button
                                    className="mt-2 text-xs text-primary hover:underline"
                                    onClick={() => setActiveTab("notes")}
                                  >
                                    View in Notes →
                                  </button>
                                </div>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground">
                              {format(parseISO(activity.createdAt), "MMM d, h:mm a")}
                            </p>
                          </div>
                        </div>
                      );
                    }
                    const ACTIVITY_TYPE_LABELS: Record<string, string> = {
                      created: "Created",
                      stage_changed: "Stage Changed",
                      note_added: "Note Added",
                      followup_added: "Follow-up Scheduled",
                      followup_updated: "Follow-up Updated",
                      assigned: "Assigned",
                      task_added: "Task Added",
                      task_updated: "Task Updated",
                      task_completed: "Task Completed",
                      email_sent: "Email Sent",
                      converted: "Converted",
                      status_changed: "Status Changed",
                      field_updated: "Field Updated",
                    };
                    const ACTIVITY_TYPE_COLORS: Record<string, string> = {
                      created: "bg-blue-50 text-blue-600 border-blue-200 dark:bg-blue-950/30 dark:text-blue-400",
                      stage_changed: "bg-purple-50 text-purple-600 border-purple-200 dark:bg-purple-950/30 dark:text-purple-400",
                      note_added: "bg-slate-50 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-300",
                      followup_added: "bg-amber-50 text-amber-600 border-amber-200 dark:bg-amber-950/30 dark:text-amber-400",
                      followup_updated: "bg-amber-50 text-amber-600 border-amber-200 dark:bg-amber-950/30 dark:text-amber-400",
                      assigned: "bg-green-50 text-green-600 border-green-200 dark:bg-green-950/30 dark:text-green-400",
                      task_added: "bg-teal-50 text-teal-600 border-teal-200 dark:bg-teal-950/30 dark:text-teal-400",
                      task_updated: "bg-teal-50 text-teal-600 border-teal-200 dark:bg-teal-950/30 dark:text-teal-400",
                      task_completed: "bg-green-50 text-green-600 border-green-200 dark:bg-green-950/30 dark:text-green-400",
                    };
                    const typeLabel = ACTIVITY_TYPE_LABELS[activity.type] ?? activity.type;
                    const typeColor = ACTIVITY_TYPE_COLORS[activity.type] ?? "bg-muted text-muted-foreground border-border";
                    return (
                      <div key={activity.id} className="relative">
                        <div className="absolute -left-[35px] bg-background border rounded-full p-1.5 shadow-sm">
                          <ActivityIcon type={activity.type} />
                        </div>
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded border ${typeColor}`}>
                              {typeLabel}
                            </span>
                          </div>
                          <p className="text-sm">
                            <span className="font-medium">{activity.userName || "System"}</span>{" "}
                            <span className="text-muted-foreground">{activity.description}</span>
                          </p>
                          {(activity.oldValue || (activity.newValue && !activity.newValue.startsWith("email:"))) && (
                            <p className="text-xs text-muted-foreground">
                              {activity.oldValue && <span className="line-through mr-1">{activity.oldValue}</span>}
                              {activity.oldValue && activity.newValue && "→ "}
                              {activity.newValue && !activity.newValue.startsWith("email:") && <span className="font-medium">{activity.newValue}</span>}
                            </p>
                          )}
                          <p className="text-xs text-muted-foreground">
                            {format(parseISO(activity.createdAt), "MMM d, yyyy 'at' h:mm a")}
                          </p>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </TabsContent>

            {/* Audit History Tab */}
            <TabsContent value="audit" className="pt-5 m-0">
              {loadingAudit ? (
                <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
              ) : !auditLogs?.logs?.length ? (
                <p className="text-center text-muted-foreground py-8 text-sm">No audit history for this lead.</p>
              ) : (
                <div className="space-y-2">
                  {auditLogs.logs.map((log) => (
                    <div key={log.id} className="border rounded-lg p-3 space-y-1.5">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-xs font-mono">{log.action}</Badge>
                          {log.fieldName && <span className="text-xs text-muted-foreground">· {log.fieldName}</span>}
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {log.userName && `${log.userName} · `}
                          {format(parseISO(log.createdAt), "MMM d, yyyy 'at' h:mm a")}
                        </span>
                      </div>
                      {(log.oldValue || log.newValue) && (
                        <div className="text-xs flex items-center gap-2 flex-wrap">
                          {log.oldValue && (
                            <span className="bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400 px-2 py-0.5 rounded line-through">{log.oldValue}</span>
                          )}
                          {log.oldValue && log.newValue && <span className="text-muted-foreground">→</span>}
                          {log.newValue && (
                            <span className="bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-400 px-2 py-0.5 rounded">{log.newValue}</span>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>
          </Tabs>
        </div>
      </div>

      {/* Edit Details Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Lead Details</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-4">
            <div className="space-y-2">
              <Label>Company Name <span className="text-destructive">*</span></Label>
              <Input value={formData.companyName || ""} onChange={(e) => setFormData({ ...formData, companyName: e.target.value })} className={formErrors.companyName ? "border-destructive" : ""} />
              {formErrors.companyName && <p className="text-xs text-destructive">{formErrors.companyName}</p>}
            </div>
            <div className="space-y-2">
              <Label>Contact Person <span className="text-destructive">*</span></Label>
              <Input value={formData.contactPerson || ""} onChange={(e) => setFormData({ ...formData, contactPerson: e.target.value })} className={formErrors.contactPerson ? "border-destructive" : ""} />
              {formErrors.contactPerson && <p className="text-xs text-destructive">{formErrors.contactPerson}</p>}
            </div>
            <div className="space-y-2">
              <Label>Designation</Label>
              <Input value={(formData as any).designation || ""} onChange={(e) => setFormData({ ...formData, designation: e.target.value })} placeholder="e.g. CEO, CTO" />
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input value={formData.email || ""} onChange={(e) => setFormData({ ...formData, email: e.target.value })} className={formErrors.email ? "border-destructive" : ""} />
              {formErrors.email && <p className="text-xs text-destructive">{formErrors.email}</p>}
            </div>
            <div className="space-y-2">
              <Label>Phone</Label>
              <Input value={formData.phone || ""} onChange={(e) => setFormData({ ...formData, phone: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Location</Label>
              <Input value={formData.location || ""} onChange={(e) => setFormData({ ...formData, location: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Industry</Label>
              <IndustrySelect value={formData.industry || ""} onChange={(v) => setFormData({ ...formData, industry: v })} />
            </div>
            <div className="space-y-2">
              <Label>LinkedIn URL</Label>
              <Input value={(formData as any).linkedinUrl || ""} onChange={(e) => setFormData({ ...formData, linkedinUrl: e.target.value })} placeholder="https://linkedin.com/in/..." className={formErrors.linkedinUrl ? "border-destructive" : ""} />
              {formErrors.linkedinUrl && <p className="text-xs text-destructive">{formErrors.linkedinUrl}</p>}
            </div>
            <div className="space-y-2">
              <Label>Website</Label>
              <Input value={(formData as any).websiteUrl || ""} onChange={(e) => setFormData({ ...formData, websiteUrl: e.target.value })} placeholder="https://acme.com" className={formErrors.websiteUrl ? "border-destructive" : ""} />
              {formErrors.websiteUrl && <p className="text-xs text-destructive">{formErrors.websiteUrl}</p>}
            </div>
            <div className="col-span-2 space-y-2">
              <Label>Remark</Label>
              <textarea value={(formData as any).remarks || ""} onChange={(e) => setFormData({ ...formData, remarks: e.target.value })} rows={2} className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring resize-none" />
            </div>
            <div className="col-span-2 space-y-2">
              <Label>Comment</Label>
              <textarea value={(formData as any).comment || ""} onChange={(e) => setFormData({ ...formData, comment: e.target.value })} rows={2} className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring resize-none" />
            </div>
            <div className="space-y-2">
              <Label>Priority</Label>
              <PrioritySelect value={formData.priority} onChange={(v) => setFormData({ ...formData, priority: v })} />
            </div>
            <div className="space-y-2">
              <Label>Lead Source</Label>
              <select
                value={formData.channel ?? ""}
                onChange={e => setFormData({ ...formData, channel: e.target.value || null })}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="">No source</option>
                {Object.entries(CHANNEL_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label>Deal Value</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={(formData as any).valueAmount ?? ""}
                onChange={e => setFormData({ ...formData, valueAmount: e.target.value || null })}
                placeholder="0.00"
              />
            </div>
            <div className="space-y-2">
              <Label>Expected Close Date <span className="text-muted-foreground font-normal text-xs">(optional)</span></Label>
              <div className="flex gap-1.5">
                <Input
                  type="date"
                  value={(formData as any).expectedCloseDate ? (formData as any).expectedCloseDate.substring(0, 10) : ""}
                  onChange={e => setFormData({ ...formData, expectedCloseDate: e.target.value || null })}
                  className="flex-1"
                />
                {(formData as any).expectedCloseDate && (
                  <Button type="button" variant="ghost" size="icon" className="h-9 w-9 shrink-0 text-muted-foreground" onClick={() => setFormData({ ...formData, expectedCloseDate: null })}>
                    ×
                  </Button>
                )}
              </div>
            </div>
            <div className="col-span-2 space-y-2">
              <Label>Tags</Label>
              <div className="flex flex-wrap gap-2 p-3 border rounded-md bg-background min-h-[40px]">
                {allTags?.length === 0 && <span className="text-xs text-muted-foreground">No tags available. Create some in Settings.</span>}
                {allTags?.map((tag: any) => {
                  const selected = (formData.tagIds ?? []).includes(tag.id);
                  return (
                    <button
                      key={tag.id}
                      type="button"
                      onClick={() => toggleTagInForm(tag.id)}
                      className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full border font-medium transition-all ${selected ? "opacity-100 shadow-sm" : "opacity-50 hover:opacity-75"}`}
                      style={{ backgroundColor: selected ? `${tag.color}20` : "transparent", color: tag.color, borderColor: tag.color }}
                    >
                      {tag.name}{selected && <span className="ml-0.5">✓</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
          {editServerError && (
            <p className="text-sm text-destructive px-1 -mb-2" role="alert">{editServerError}</p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button variant="cta" onClick={handleSaveDetails} disabled={updateLead.isPending}>
              {updateLead.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />} Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Schedule Follow-up Dialog */}
      <Dialog open={followupOpen} onOpenChange={setFollowupOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Schedule Follow-up</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Date & Time</Label>
              <Input type="datetime-local" value={followupData.scheduledAt} onChange={(e) => setFollowupData({ ...followupData, scheduledAt: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Notes (optional)</Label>
              <Textarea value={followupData.notes} onChange={(e) => setFollowupData({ ...followupData, notes: e.target.value })} placeholder="What's the goal of this follow-up?" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFollowupOpen(false)}>Cancel</Button>
            <Button variant="cta" onClick={handleAddFollowup} disabled={!followupData.scheduledAt || createFollowup.isPending}>
              {createFollowup.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Schedule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Follow-up Dialog */}
      <Dialog open={!!editFollowupId} onOpenChange={(o) => { if (!o) setEditFollowupId(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Follow-up</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Date & Time</Label>
              <Input
                type="datetime-local"
                value={editFollowupForm.scheduledAt}
                onChange={(e) => setEditFollowupForm({ ...editFollowupForm, scheduledAt: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Notes (optional)</Label>
              <Textarea
                value={editFollowupForm.notes}
                onChange={(e) => setEditFollowupForm({ ...editFollowupForm, notes: e.target.value })}
                placeholder="What's the goal of this follow-up?"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditFollowupId(null)}>Cancel</Button>
            <Button variant="cta" onClick={handleSaveEditFollowup} disabled={!editFollowupForm.scheduledAt || updateFollowup.isPending}>
              {updateFollowup.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reschedule Follow-up Dialog */}
      <Dialog
        open={!!rescheduleFollowupId}
        onOpenChange={(o) => { if (!o) { setRescheduleFollowupId(null); setRescheduleScheduledAt(""); } }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reschedule Follow-up</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <p className="text-sm text-muted-foreground">
              Pick a new date and time. The follow-up will be reset to <strong>pending</strong>.
            </p>
            <div className="space-y-2">
              <Label>New Date & Time</Label>
              <Input
                type="datetime-local"
                value={rescheduleScheduledAt}
                onChange={(e) => setRescheduleScheduledAt(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setRescheduleFollowupId(null); setRescheduleScheduledAt(""); }}>
              Cancel
            </Button>
            <Button
              variant="cta"
              onClick={handleConfirmReschedule}
              disabled={!rescheduleScheduledAt || updateFollowup.isPending}
            >
              {updateFollowup.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Confirm Reschedule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Note Confirm */}
      {/* Delete Lead confirmation */}
      <AlertDialog open={deleteLeadOpen} onOpenChange={setDeleteLeadOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this lead?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{lead.companyName}</strong> and all its notes, follow-ups, and attachments will be permanently removed. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteLead.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteLead.isPending}
              onClick={async (e) => {
                e.preventDefault();
                try {
                  await deleteLead.mutateAsync({ id });
                  setDeleteLeadOpen(false);
                  navigate("/leads");
                } catch {
                  toast({ title: "Failed to delete lead", variant: "destructive" });
                  setDeleteLeadOpen(false);
                }
              }}
            >
              {deleteLead.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Delete permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deleteNoteId} onOpenChange={(o) => { if (!o) setDeleteNoteId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete note?</AlertDialogTitle>
            <AlertDialogDescription>This will permanently delete the note. This action cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteNote} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Attachment Confirm */}
      <AlertDialog open={!!deleteAttachmentId} onOpenChange={(o) => { if (!o) setDeleteAttachmentId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete attachment?</AlertDialogTitle>
            <AlertDialogDescription>This will permanently delete the file. This action cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteAttachment} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Convert Lead Dialog */}
      <Dialog open={convertOpen} onOpenChange={setConvertOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Convert Lead to CRM Records</DialogTitle>
          </DialogHeader>
          {convertResult ? (
            <div className="py-6 space-y-3">
              <div className="flex items-center gap-2 text-green-600 font-semibold">
                <CheckCircle2 className="h-5 w-5" />Lead converted successfully!
              </div>
              <div className="text-sm text-muted-foreground space-y-1">
                <p>✓ Contact created (ID: {convertResult.contactId})</p>
                {convertResult.accountId && <p>✓ Account created (ID: {convertResult.accountId})</p>}
                {convertResult.dealId && <p>✓ Deal created (ID: {convertResult.dealId})</p>}
              </div>
              <div className="flex gap-2 pt-2">
                <Button size="sm" asChild><Link href="/contacts">View Contacts</Link></Button>
                {convertResult.dealId && <Button size="sm" variant="outline" asChild><Link href="/deals">View Deals</Link></Button>}
              </div>
            </div>
          ) : (
            <>
              <div className="space-y-4 py-2">
                {convertDealConflict && (
                  <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30 p-3">
                    <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                    <div className="flex-1 text-sm">
                      <p className="font-medium text-amber-800 dark:text-amber-300">Deal already exists for this lead</p>
                      <p className="text-amber-700 dark:text-amber-400 mt-0.5">
                        "<strong>{convertDealConflict.dealName}</strong>" was already created from this lead.
                        Uncheck <em>Create Deal</em> below to convert without creating another, or{" "}
                        <Link href="/deals" className="underline underline-offset-2 font-medium" onClick={() => setConvertOpen(false)}>view it in Deals</Link>.
                      </p>
                    </div>
                  </div>
                )}
                <p className="text-sm text-muted-foreground">This will create CRM records from <strong>{lead?.companyName}</strong>. You can customize the details below.</p>

                <div className="space-y-3 border rounded-lg p-4">
                  <p className="text-sm font-semibold">Contact Info</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">First Name</Label>
                      <Input
                        value={convertForm.contactFirstName ?? lead?.contactPerson?.split(" ")[0] ?? ""}
                        onChange={e => setConvertForm(f => ({ ...f, contactFirstName: e.target.value }))}
                        placeholder={lead?.contactPerson?.split(" ")[0]}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Last Name</Label>
                      <Input
                        value={convertForm.contactLastName ?? lead?.contactPerson?.split(" ").slice(1).join(" ") ?? ""}
                        onChange={e => setConvertForm(f => ({ ...f, contactLastName: e.target.value }))}
                      />
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between border rounded-lg p-4">
                  <div>
                    <p className="text-sm font-semibold">Create Account</p>
                    <p className="text-xs text-muted-foreground">Create a company account for {lead?.companyName}</p>
                  </div>
                  <input type="checkbox" checked={convertForm.createAccount !== false} onChange={e => setConvertForm(f => ({ ...f, createAccount: e.target.checked }))} className="h-4 w-4 accent-primary" />
                </div>

                <div className="border rounded-lg p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold">Create Deal</p>
                      <p className="text-xs text-muted-foreground">Track the sales opportunity</p>
                    </div>
                    <input type="checkbox" checked={convertForm.createDeal !== false} onChange={e => setConvertForm(f => ({ ...f, createDeal: e.target.checked }))} className="h-4 w-4 accent-primary" />
                  </div>
                  {convertForm.createDeal !== false && (
                    <div className="grid grid-cols-2 gap-3 pt-1">
                      <div className="space-y-1">
                        <Label className="text-xs">Deal Name</Label>
                        <Input
                          value={convertForm.dealName ?? `${lead?.companyName ?? ""} Deal`}
                          onChange={e => setConvertForm(f => ({ ...f, dealName: e.target.value }))}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Deal Value</Label>
                        <Input
                          type="number"
                          value={convertForm.dealValue ?? ""}
                          onChange={e => setConvertForm(f => ({ ...f, dealValue: e.target.value }))}
                          placeholder="50000"
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setConvertOpen(false)}>Cancel</Button>
                <Button
                  variant="cta"
                  onClick={async () => {
                    try {
                      const result = await convertLead.mutateAsync({ id, data: convertForm });
                      setConvertResult({ contactId: result.contactId ?? null, accountId: result.accountId ?? null, dealId: result.dealId ?? null });
                      setConvertDealConflict(null);
                      queryClient.invalidateQueries({ queryKey: getGetLeadQueryKey(id) });
                      queryClient.invalidateQueries({ queryKey: getListActivitiesQueryKey(id) });
                    } catch (e: any) {
                      // The convert endpoint returns 409 only for the deal_exists case —
                      // checking status alone is sufficient and avoids body-parse fragility.
                      if (e?.status === 409) {
                        const d = e?.data ?? {};
                        setConvertDealConflict({
                          dealId: d.dealId ?? 0,
                          dealName: d.dealName ?? "an existing deal",
                        });
                      } else {
                        toast({ title: "Conversion failed", description: e.message, variant: "destructive" });
                      }
                    }
                  }}
                  disabled={convertLead.isPending}
                >
                  {convertLead.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Convert Lead
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {emailDialogOpen && (
        <EmailComposeDialog
          open={emailDialogOpen}
          onOpenChange={(v) => {
            setEmailDialogOpen(v);
            if (!v) setEmailInitialValues(undefined);
          }}
          leadId={id}
          toEmail={lead.email ?? ""}
          contactName={lead.contactPerson}
          companyName={lead.companyName}
          repName={[authUser?.firstName, authUser?.lastName].filter(Boolean).join(" ") || authUser?.username || "the team"}
          initialValues={emailInitialValues}
        />
      )}

      {/* Blur overlay while lead delete is in flight */}
      {deleteLead.isPending && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/60 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="h-10 w-10 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground font-medium">Deleting lead…</p>
          </div>
        </div>
      )}
    </div>
  );
}

function parseEmailNoteContent(content: string): { to: string; subject: string; body: string } | null {
  const match = content.match(/^\*\*To:\*\* (.+)\n\*\*Subject:\*\* (.+)\n\n([\s\S]*)$/);
  if (!match) return null;
  return { to: match[1].trim(), subject: match[2].trim(), body: match[3].trim() };
}

function ActivityIcon({ type }: { type: string }) {
  const cls = "h-3.5 w-3.5 text-muted-foreground";
  switch (type) {
    case "created": return <Briefcase className={`${cls} text-blue-500`} />;
    case "stage_changed": return <Target className={cls} />;
    case "note_added": return <MessageSquareIcon className={cls} />;
    case "followup_added":
    case "followup_updated": return <CalendarIcon className={cls} />;
    case "assigned": return <User className={cls} />;
    case "task_added":
    case "task_updated":
    case "task_completed": return <CheckCircle2 className={`${cls} text-green-500`} />;
    default: return <Clock className={cls} />;
  }
}

const Target = (p: any) => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>;
const MessageSquareIcon = (p: any) => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>;
