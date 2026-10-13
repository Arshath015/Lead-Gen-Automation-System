import { Resend } from "resend";
import { env } from "../config/env";
import type { WebhookEventPayload } from "resend";

const client = new Resend(env.resendApiKey);

export class WebhookNotConfiguredError extends Error {
  constructor() {
    super("RESEND_WEBHOOK_SECRET is not configured");
    this.name = "WebhookNotConfiguredError";
  }
}

// Signature verification is a pure local HMAC check (Standard Webhooks /
// Svix spec) — no network call to Resend is involved. Throws on a missing
// secret or an invalid/forged/expired signature; callers must not process
// the payload unless this resolves successfully.
export function verifyResendWebhook(rawBody: string, headers: Record<string, string | string[] | undefined>): WebhookEventPayload {
  if (!env.resendWebhookSecret) {
    throw new WebhookNotConfiguredError();
  }

  const id = headers["svix-id"];
  const timestamp = headers["svix-timestamp"];
  const signature = headers["svix-signature"];

  if (typeof id !== "string" || typeof timestamp !== "string" || typeof signature !== "string") {
    throw new Error("Missing svix-id/svix-timestamp/svix-signature headers");
  }

  return client.webhooks.verify({
    payload: rawBody,
    headers: { id, timestamp, signature },
    webhookSecret: env.resendWebhookSecret,
  });
}
