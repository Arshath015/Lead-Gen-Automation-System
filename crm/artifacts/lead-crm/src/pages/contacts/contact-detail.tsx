import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { useGetContact, useListContactNotes, useCreateContactNote } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ArrowLeft, Mail, Phone, Loader2, User, Building2 } from "lucide-react";
import { format, parseISO } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { parseEmailNote } from "@/lib/parseEmailNote";
import { EmailNoteContent } from "@/components/email-note-card";

type NoteType = "note" | "email" | "call";

const NOTE_TYPES: { value: NoteType; label: string; color: string }[] = [
  { value: "note", label: "Note", color: "bg-gray-100 text-gray-700" },
  { value: "email", label: "Email", color: "bg-blue-100 text-blue-700" },
  { value: "call", label: "Call", color: "bg-green-100 text-green-700" },
];

export default function ContactDetail() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const { data: contact, isLoading } = useGetContact(id);
  const { data: notes = [], refetch: refetchNotes } = useListContactNotes(id);
  const createNote = useCreateContactNote();

  const [noteType, setNoteType] = useState<NoteType>("note");
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!content.trim()) return;
    setSubmitting(true);
    try {
      await createNote.mutateAsync({ contactId: id, data: { type: noteType, content: content.trim() } });
      setContent("");
      refetchNotes();
      toast({ title: `${noteType === "email" ? "Email" : noteType === "call" ? "Call" : "Note"} logged` });
    } catch {
      toast({ title: "Failed to log", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!contact) {
    return <div className="p-6 text-muted-foreground">Contact not found.</div>;
  }

  const fullName = [contact.firstName, contact.lastName].filter(Boolean).join(" ");
  const initials = [contact.firstName?.[0], contact.lastName?.[0]].filter(Boolean).join("").toUpperCase() || "?";

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate("/contacts")}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Contacts
        </Button>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="flex items-start gap-4">
            <Avatar className="h-14 w-14">
              <AvatarFallback className="text-lg font-semibold bg-primary/10 text-primary">{initials}</AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <h1 className="text-xl font-semibold">{fullName}</h1>
              {contact.title && <p className="text-sm text-muted-foreground mt-0.5">{contact.title}</p>}
              <div className="flex flex-wrap gap-4 mt-3 text-sm text-muted-foreground">
                {contact.email && (
                  <span className="flex items-center gap-1.5">
                    <Mail className="h-3.5 w-3.5" /> {contact.email}
                  </span>
                )}
                {contact.phone && (
                  <span className="flex items-center gap-1.5">
                    <Phone className="h-3.5 w-3.5" /> {contact.phone}
                  </span>
                )}
                {contact.accountName && (
                  <span className="flex items-center gap-1.5">
                    <Building2 className="h-3.5 w-3.5" /> {contact.accountName}
                  </span>
                )}
                {contact.ownerName && (
                  <span className="flex items-center gap-1.5">
                    <User className="h-3.5 w-3.5" /> {contact.ownerName}
                  </span>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Log Activity</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            {NOTE_TYPES.map(t => (
              <button
                key={t.value}
                onClick={() => setNoteType(t.value)}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors border ${
                  noteType === t.value ? t.color + " border-transparent" : "border-border text-muted-foreground hover:bg-muted"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <Textarea
            placeholder={noteType === "email" ? "Email content or summary…" : noteType === "call" ? "Call notes…" : "Add a note…"}
            value={content}
            onChange={e => setContent(e.target.value)}
            rows={3}
            className="resize-none"
          />
          <div className="flex justify-end">
            <Button size="sm" onClick={handleSubmit} disabled={!content.trim() || submitting}>
              {submitting && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
              Log {noteType === "email" ? "Email" : noteType === "call" ? "Call" : "Note"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {notes.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Activity Log</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {[...notes].reverse().map(note => {
                const typeInfo = NOTE_TYPES.find(t => t.value === note.type) ?? NOTE_TYPES[0];
                const isEmail = note.type === "email";
                const parsedEmail = isEmail ? parseEmailNote(note.content) : null;
                return (
                  <div key={note.id} className="flex gap-3">
                    {isEmail ? (
                      <div className="mt-0.5 h-7 w-7 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center shrink-0">
                        <Mail className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
                      </div>
                    ) : (
                      <Avatar className="h-7 w-7 mt-0.5 shrink-0">
                        <AvatarFallback className="text-xs">
                          {note.createdByName ? note.createdByName.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2) : "?"}
                        </AvatarFallback>
                      </Avatar>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-medium">{note.createdByName ?? "Unknown"}</span>
                        <Badge variant="outline" className={`text-xs px-1.5 py-0 ${typeInfo.color} border-transparent`}>
                          {typeInfo.label}
                        </Badge>
                        <span className="text-xs text-muted-foreground ml-auto">
                          {format(parseISO(note.createdAt), "MMM d, yyyy")}
                        </span>
                      </div>
                      {isEmail && parsedEmail ? (
                        <EmailNoteContent parsedEmail={parsedEmail} />
                      ) : (
                        <p className="text-sm text-muted-foreground whitespace-pre-wrap">{note.content}</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
