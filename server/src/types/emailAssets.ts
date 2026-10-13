// Inline images referenced from inside the rich-text email signature.
// Conceptually separate from DefaultAttachment below: these are embedded
// *inside* the signature HTML (e.g. a logo or headshot) and sent as CID
// inline attachments, never listed as a normal file attachment.
export interface SignatureImageAsset {
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
}

// A normal file attachment the user has uploaded once in Settings and can
// choose to include on newly sent emails/follow-ups going forward. Separate
// from the signature: toggled per-file via `includeByDefault`, never
// embedded inline in the HTML.
export interface DefaultAttachment {
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  includeByDefault: boolean;
  createdAt: string;
}
