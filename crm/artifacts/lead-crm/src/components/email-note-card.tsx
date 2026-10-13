import type { ParsedEmail } from "@/lib/parseEmailNote";

interface EmailNoteContentProps {
  parsedEmail: ParsedEmail;
}

export function EmailNoteContent({ parsedEmail }: EmailNoteContentProps) {
  return (
    <div className="flex-1 min-w-0">
      <div className="flex flex-wrap gap-x-4 gap-y-0.5 mb-2">
        <span className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">To:</span> {parsedEmail.to}
        </span>
        <span className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Subject:</span> {parsedEmail.subject}
        </span>
      </div>
      {parsedEmail.body && (
        <p className="text-sm whitespace-pre-wrap text-muted-foreground border-t pt-2 mt-1">
          {parsedEmail.body}
        </p>
      )}
    </div>
  );
}
