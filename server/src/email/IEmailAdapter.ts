export interface EmailSendResult {
  id: string;
}

// Common interface for transactional email providers used to send outreach emails.
export interface IEmailAdapter {
  readonly name: string;
  send(params: {
    to: string;
    subject: string;
    body: string;
    idempotencyKey?: string;
    // Real SMTP Message-IDs (not Resend's own send-id) for threading a
    // follow-up onto a prior message — omitted entirely for a thread-root
    // send (the initial outreach email has nothing to reply to).
    inReplyTo?: string;
    references?: string[];
  }): Promise<EmailSendResult>;
}
