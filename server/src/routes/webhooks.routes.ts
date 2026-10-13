import { Router } from "express";
import { verifyResendWebhook, WebhookNotConfiguredError } from "../email/resendWebhooks";
import { processResendWebhookEvent } from "../services/engagementPipeline";

export const webhooksRouter = Router();

webhooksRouter.post("/resend", async (req, res) => {
  let event;
  try {
    // req.rawBody is captured by express.json()'s verify hook in index.ts —
    // signature verification needs the exact original bytes, not a
    // re-serialization of the parsed body.
    event = verifyResendWebhook(req.rawBody ?? "", req.headers as Record<string, string | undefined>);
  } catch (err) {
    if (err instanceof WebhookNotConfiguredError) {
      return res.status(503).json({ error: "Webhook receiver not configured yet" });
    }
    return res.status(401).json({ error: "Invalid webhook signature" });
  }

  // The same id used for signature verification (svix-id) also doubles as
  // the idempotency key for processing — Resend/Svix redeliver an event with
  // the same id on retry, so this is what lets processResendWebhookEvent
  // safely no-op a duplicate delivery instead of double-applying it.
  const webhookEventId = req.headers["svix-id"];
  if (typeof webhookEventId !== "string") {
    return res.status(400).json({ error: "Missing svix-id header" });
  }

  try {
    await processResendWebhookEvent(event, webhookEventId);
    res.status(200).json({ received: true });
  } catch (err) {
    console.error(`[webhooks] failed to process ${event.type}: ${(err as Error).message}`);
    // Still 200: the event was valid and understood, our own processing
    // failure shouldn't make Resend retry-storm an event we already logged.
    res.status(200).json({ received: true, processed: false });
  }
});
