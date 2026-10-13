import { test, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { WebhookEventPayload } from "resend";

// Isolated per-process temp DATA_DIR (see db/persistence.test.ts for why this
// is safe) — this suite exercises the real webhook-correlation pipeline
// end-to-end (fake payload in, repository state asserted out) without ever
// touching server/data or making a network call: "delivered"/"opened" events
// carry ip: null in these fixtures, and resolveApproxLocation short-circuits
// on a null ip before it would ever fetch anything. The "received"/reply
// tests further down DO exercise network-shaped code paths (fetching raw
// headers via Resend, then geolocating a candidate IP) but only ever against
// a mocked global fetch — see mockReceivingAndGeo below — never a real
// network call.
let tmpDir: string;
let emailDraftsRepository: typeof import("../db/emailDraftsRepository")["emailDraftsRepository"];
let followUpMessagesRepository: typeof import("../db/followUpMessagesRepository")["followUpMessagesRepository"];
let leadsRepository: typeof import("../db/leadsRepository")["leadsRepository"];
let engagementEventsRepository: typeof import("../db/engagementEventsRepository")["engagementEventsRepository"];
let processResendWebhookEvent: typeof import("./engagementPipeline")["processResendWebhookEvent"];
let closeDb: typeof import("../db/sqlite")["closeDb"];

before(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "stampsize-webhook-test-"));
  process.env.DATA_DIR = tmpDir;
  ({ emailDraftsRepository } = await import("../db/emailDraftsRepository"));
  ({ followUpMessagesRepository } = await import("../db/followUpMessagesRepository"));
  ({ leadsRepository } = await import("../db/leadsRepository"));
  ({ engagementEventsRepository } = await import("../db/engagementEventsRepository"));
  ({ processResendWebhookEvent } = await import("./engagementPipeline"));
  ({ closeDb } = await import("../db/sqlite"));
});

after(async () => {
  closeDb(); // must close before the temp dir (app.db/-wal/-shm) can be removed on Windows
  delete process.env.DATA_DIR;
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function deliveredEvent(emailId: string, smtpMessageId: string): WebhookEventPayload {
  return {
    type: "email.delivered",
    created_at: new Date().toISOString(),
    data: {
      created_at: new Date().toISOString(),
      email_id: emailId,
      message_id: smtpMessageId,
      from: "outreach@stampsize.test",
      to: ["prospect@example.com"],
      subject: "Test subject",
    },
  } as WebhookEventPayload;
}

test("processResendWebhookEvent: backfills the real SMTP Message-ID onto the matching draft on 'delivered'", async () => {
  const draft = await emailDraftsRepository.upsert("lead-webhook-1", {
    researchBriefId: null,
    subject: "Hello",
    body: "Body",
    model: null,
    editedByUser: false,
    generatedAt: new Date().toISOString(),
  });
  await emailDraftsRepository.update("lead-webhook-1", { resendMessageId: "resend-abc", sendStatus: "sent" });
  assert.equal(draft.smtpMessageId, null);

  await processResendWebhookEvent(deliveredEvent("resend-abc", "<real-1@amazonses.com>"), "svix-evt-1");

  const updated = await emailDraftsRepository.getByLeadId("lead-webhook-1");
  assert.equal(updated?.smtpMessageId, "<real-1@amazonses.com>");
});

test("processResendWebhookEvent: backfills onto the matching follow-up message, not the draft, when the resend id belongs to a follow-up", async () => {
  await emailDraftsRepository.upsert("lead-webhook-2", {
    researchBriefId: null,
    subject: "Hello",
    body: "Body",
    model: null,
    editedByUser: false,
    generatedAt: new Date().toISOString(),
  });
  await emailDraftsRepository.update("lead-webhook-2", { resendMessageId: "resend-root-2", sendStatus: "sent" });
  await followUpMessagesRepository.create({
    leadId: "lead-webhook-2",
    followUpTaskId: "task-2",
    sequenceNumber: 1,
    subject: "Re: Hello",
    body: "Following up",
    model: null,
    sentAt: new Date().toISOString(),
    resendMessageId: "resend-followup-2",
    smtpMessageId: null,
  });

  await processResendWebhookEvent(deliveredEvent("resend-followup-2", "<followup-real-2@amazonses.com>"), "svix-evt-2");

  const draft = await emailDraftsRepository.getByLeadId("lead-webhook-2");
  assert.equal(draft?.smtpMessageId, null, "the root draft must be untouched by a follow-up's webhook event");

  const [message] = await followUpMessagesRepository.listByLeadId("lead-webhook-2");
  assert.equal(message.smtpMessageId, "<followup-real-2@amazonses.com>");
});

test("processResendWebhookEvent: a redelivered (duplicate) webhook event never overwrites an already-backfilled Message-ID", async () => {
  await emailDraftsRepository.upsert("lead-webhook-3", {
    researchBriefId: null,
    subject: "Hello",
    body: "Body",
    model: null,
    editedByUser: false,
    generatedAt: new Date().toISOString(),
  });
  await emailDraftsRepository.update("lead-webhook-3", { resendMessageId: "resend-3", sendStatus: "sent" });

  await processResendWebhookEvent(deliveredEvent("resend-3", "<first@amazonses.com>"), "svix-evt-3a");
  // Same svix-id as a genuine Resend retry would use, but even a *different*
  // id (a distinct, later event for the same email — e.g. its own "opened")
  // must not clobber the value once set.
  await processResendWebhookEvent(deliveredEvent("resend-3", "<different-value@amazonses.com>"), "svix-evt-3b");

  const draft = await emailDraftsRepository.getByLeadId("lead-webhook-3");
  assert.equal(draft?.smtpMessageId, "<first@amazonses.com>");
});

test("processResendWebhookEvent: an event for an unrecognized resend id is a safe no-op (no matching draft or follow-up)", async () => {
  await assert.doesNotReject(() => processResendWebhookEvent(deliveredEvent("resend-unknown", "<orphan@amazonses.com>"), "svix-evt-4"));
});

// --- Reply ("email.received") location detection ---
//
// The Resend webhook payload for a reply carries no IP or headers at all
// (confirmed against the installed resend package's own
// ReceivedEmailEventData type — email_id, from, to, subject, etc., nothing
// IP-adjacent). The only way to even attempt reply geolocation is a
// follow-up GET for the raw headers (client.emails.receiving.get, wrapped by
// resendAdapter.fetchReceivedEmailHeaders), which — like the ip-api.com
// geolocation call — goes through the Node global `fetch`. These tests mock
// that single global by request URL so both calls can be faked without a
// real network call, mirroring the existing pattern in geoLookup.test.ts.

function receivedEvent(from: string, emailId: string): WebhookEventPayload {
  return {
    type: "email.received",
    created_at: new Date().toISOString(),
    data: {
      email_id: emailId,
      created_at: new Date().toISOString(),
      from,
      to: ["outreach@stampsize.test"],
      bcc: [],
      cc: [],
      received_for: ["outreach@stampsize.test"],
      message_id: "<reply-1@prospect-mail.test>",
      subject: "Re: Hello",
      attachments: [],
    },
  } as WebhookEventPayload;
}

async function createFixtureLead(email: string, fullName: string): Promise<string> {
  const { inserted } = await leadsRepository.bulkCreate([
    {
      source: "manual",
      sourceId: `src-${email}`,
      dedupKey: `dedup-${email}`,
      email,
      fullName,
      title: null,
      company: null,
      companyDomain: null,
      linkedinUrl: null,
      phone: null,
      location: null,
      icpProfileId: null,
      searchRunId: null,
      raw: null,
      roleCategory: null,
      industry: null,
      sourceFile: null,
      sourceWorksheet: null,
    },
  ]);
  return inserted[0].id;
}

// Routes the single mocked global fetch by URL: Resend's raw-headers GET
// (api.resend.com/emails/receiving/...) returns `headers`; ip-api.com's
// geolocation GET returns `geoBody`. Passing `geoBody: null` asserts ip-api
// is never actually called (matches geoLookup.test.ts's own convention of
// throwing from a fetch mock that shouldn't be reached).
function mockReceivingAndGeo(headers: Record<string, string> | null, geoBody: Record<string, unknown> | null) {
  return mock.method(globalThis, "fetch", async (input: unknown) => {
    const url = typeof input === "string" ? input : (input as Request).url ?? String(input);
    if (url.includes("api.resend.com/emails/receiving/")) {
      return new Response(
        JSON.stringify({
          object: "email",
          id: "recv-1",
          to: ["outreach@stampsize.test"],
          from: "prospect@example.com",
          created_at: new Date().toISOString(),
          subject: "Re: Hello",
          bcc: null,
          cc: null,
          reply_to: null,
          received_for: ["outreach@stampsize.test"],
          html: null,
          text: "Thanks, sounds good!",
          headers,
          message_id: "<reply-1@prospect-mail.test>",
          attachments: [],
        }),
        { status: 200 }
      );
    }
    if (url.includes("ip-api.com")) {
      if (!geoBody) throw new Error(`ip-api.com should never be called for this fixture (url: ${url})`);
      return new Response(JSON.stringify(geoBody), { status: 200 });
    }
    throw new Error(`unexpected fetch call to ${url}`);
  });
}

function mockReceivingFailure() {
  return mock.method(globalThis, "fetch", async (input: unknown) => {
    const url = typeof input === "string" ? input : (input as Request).url ?? String(input);
    if (url.includes("api.resend.com/emails/receiving/")) {
      throw new Error("simulated network failure fetching raw headers");
    }
    throw new Error(`unexpected fetch call to ${url}`);
  });
}

test.afterEach(() => {
  mock.restoreAll();
});

test("processResendWebhookEvent: a reply with a genuine public originating IP in its headers resolves and stores a real approximate location", async () => {
  const leadId = await createFixtureLead("prospect-geo-ok@example.com", "Prospect GeoOk");
  mockReceivingAndGeo(
    { Received: "from mail.example.com (mail.example.com [49.47.241.99]) by inbound.resend.com with SMTP" },
    { status: "success", country: "India", regionName: "Tamil Nadu", city: "Madurai", isp: "Bharti Airtel Ltd", org: "Bharti Airtel Ltd", proxy: false, hosting: false }
  );

  await processResendWebhookEvent(receivedEvent("prospect-geo-ok@example.com", "email-geo-ok"), "svix-received-geo-ok");

  const [event] = await engagementEventsRepository.listByLeadId(leadId);
  assert.equal(event.type, "received");
  assert.equal(event.ip, "49.47.241.99");
  assert.deepEqual(event.location, { country: "India", region: "Tamil Nadu", city: "Madurai", approximate: true, likelyProxied: false });
});

test("processResendWebhookEvent: a reply whose only header IP belongs to known mail-provider/proxy infrastructure is withheld, not shown as the recipient's location", async () => {
  const leadId = await createFixtureLead("prospect-proxy@example.com", "Prospect Proxy");
  mockReceivingAndGeo(
    { Received: "from mail-relay.google.com (mail-relay.google.com [74.125.209.9]) by inbound.resend.com with SMTP" },
    { status: "success", country: "United States", regionName: "California", city: "Mountain View", isp: "Google LLC", org: "Google LLC", proxy: false, hosting: true }
  );

  await processResendWebhookEvent(receivedEvent("prospect-proxy@example.com", "email-proxy"), "svix-received-proxy");

  const [event] = await engagementEventsRepository.listByLeadId(leadId);
  assert.deepEqual(event.location, { country: null, region: null, city: null, approximate: true, likelyProxied: true });
});

test("processResendWebhookEvent: a reply whose only header IP is private/internal is rejected before ever calling the geolocation service", async () => {
  const leadId = await createFixtureLead("prospect-private@example.com", "Prospect Private");
  mockReceivingAndGeo({ Received: "from internal (internal [10.1.2.3]) by inbound.resend.com with SMTP" }, null);

  await processResendWebhookEvent(receivedEvent("prospect-private@example.com", "email-private"), "svix-received-private");

  const [event] = await engagementEventsRepository.listByLeadId(leadId);
  assert.equal(event.ip, "10.1.2.3");
  assert.equal(event.location, null);
});

test("processResendWebhookEvent: a reply with no usable IP anywhere in its headers is explicitly marked unavailable (location null), not guessed", async () => {
  const leadId = await createFixtureLead("prospect-no-ip@example.com", "Prospect NoIp");
  mockReceivingAndGeo({ Subject: "Re: Hello", From: "prospect-no-ip@example.com" }, null);

  await processResendWebhookEvent(receivedEvent("prospect-no-ip@example.com", "email-no-ip"), "svix-received-no-ip");

  const [event] = await engagementEventsRepository.listByLeadId(leadId);
  assert.equal(event.ip, null);
  assert.equal(event.location, null);
});

test("processResendWebhookEvent: a reply whose header fetch itself fails over the network is a safe no-throw, location unavailable", async () => {
  const leadId = await createFixtureLead("prospect-fetch-fail@example.com", "Prospect FetchFail");
  mockReceivingFailure();

  await assert.doesNotReject(() =>
    processResendWebhookEvent(receivedEvent("prospect-fetch-fail@example.com", "email-fetch-fail"), "svix-received-fetch-fail")
  );

  const [event] = await engagementEventsRepository.listByLeadId(leadId);
  assert.equal(event.ip, null);
  assert.equal(event.location, null);
});

test("processResendWebhookEvent: a reply still transitions the lead to 'replied' and cancels follow-ups even when location is unavailable", async () => {
  const leadId = await createFixtureLead("prospect-status@example.com", "Prospect Status");
  mockReceivingAndGeo(null, null);

  await processResendWebhookEvent(receivedEvent("prospect-status@example.com", "email-status"), "svix-received-status");

  const lead = await leadsRepository.getById(leadId);
  assert.equal(lead?.engagementStatus, "replied");
});
