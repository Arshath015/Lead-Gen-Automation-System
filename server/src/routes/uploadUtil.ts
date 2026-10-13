import multer from "multer";

// Shared by signatureImages.routes.ts and attachments.routes.ts — turns
// multer's file-size-limit error (and any fileFilter rejection) into the
// same clear, user-facing message shape both upload endpoints return.
export function uploadErrorMessage(err: unknown, maxBytes: number): string {
  if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
    return `File too large (max ${Math.round(maxBytes / (1024 * 1024))}MB)`;
  }
  return err instanceof Error ? err.message : "Upload failed";
}
