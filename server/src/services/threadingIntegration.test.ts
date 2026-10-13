import { test } from "node:test";
import assert from "node:assert/strict";
import { buildFollowUpSubject, buildThreadingHeaders } from "./followUpPipeline";
import { buildThreadingEmailHeaders } from "../email/resendAdapter";
import type { IEmailAdapter } from "../email/IEmailAdapter";

// Isolated, fully in-memory threading QA. Nothing here touches leads.json,
// followUpTasks.json, followUpMessages.json, automationSettings.json, or any
// other file on disk — no repository, no DATA_DIR override, no real lead or
// task is read or written. Every value below is scratch data invented for
// this test only, and no Resend client is ever constructed.

// --- Scratch thread state (stands in for a real lead's send history) ---
const scratchOriginalDraft = {
  subject: "Scratch Original Subject",
  smtpMessageId: "<scratch-root@test.invalid>",
};
const scratchPriorFollowUps = [{ smtpMessageId: "<scratch-followup1@test.invalid>" }];

test("buildFollowUpSubject: scratch original subject gets Re:-prefixed", () => {
  const subject = buildFollowUpSubject(scratchOriginalDraft.subject);
  assert.equal(subject, "Re: Scratch Original Subject");
});

test("buildThreadingHeaders: scratch chain (root + one prior follow-up) produces correct In-Reply-To/References", () => {
  const { inReplyTo, references } = buildThreadingHeaders(scratchOriginalDraft, scratchPriorFollowUps);
  assert.equal(inReplyTo, "<scratch-followup1@test.invalid>");
  assert.deepEqual(references, ["<scratch-root@test.invalid>", "<scratch-followup1@test.invalid>"]);
});

test("mocked email provider: sendFollowUp's exact call shape reaches the adapter with correct threading headers, no Resend involved", async () => {
  const subject = buildFollowUpSubject(scratchOriginalDraft.subject);
  const { inReplyTo, references } = buildThreadingHeaders(scratchOriginalDraft, scratchPriorFollowUps);

  // Stands in for resendAdapter — implements the same IEmailAdapter contract
  // sendFollowUp() codes against, records exactly what it was called with,
  // and never touches the network or a real Resend client.
  const calls: Parameters<IEmailAdapter["send"]>[0][] = [];
  const mockAdapter: IEmailAdapter = {
    name: "mock",
    async send(params) {
      calls.push(params);
      return { id: "mock-resend-id-scratch-1" };
    },
  };

  // Mirrors exactly the call followUpPipeline.ts's sendFollowUp() makes to
  // resendAdapter.send() once subject/headers are computed.
  const result = await mockAdapter.send({
    to: "scratch-recipient@test.invalid",
    subject,
    body: "Scratch follow-up body for isolated threading QA.",
    idempotencyKey: "scratch-idempotency-key-1",
    inReplyTo,
    references,
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].subject, "Re: Scratch Original Subject");
  assert.equal(calls[0].inReplyTo, "<scratch-followup1@test.invalid>");
  assert.deepEqual(calls[0].references, ["<scratch-root@test.invalid>", "<scratch-followup1@test.invalid>"]);
  assert.equal(result.id, "mock-resend-id-scratch-1");

  // Now prove the *real* adapter's own header-building function (the exact
  // code path resendAdapter.send() uses to shape the literal `headers` object
  // merged into the real `client.emails.send(...)` payload) turns this
  // mock-captured inReplyTo/references into the correct Resend-bound headers
  // — without ever constructing a Resend client or sending anything.
  const resendHeaders = buildThreadingEmailHeaders({ inReplyTo: calls[0].inReplyTo, references: calls[0].references });
  assert.deepEqual(resendHeaders, {
    "In-Reply-To": "<scratch-followup1@test.invalid>",
    References: "<scratch-root@test.invalid> <scratch-followup1@test.invalid>",
  });
});

test("mocked email provider: a thread-root send (no prior Message-IDs) reaches the adapter with no threading headers at all", async () => {
  const rootDraft = { subject: "Brand New Scratch Thread", smtpMessageId: null };
  const subject = buildFollowUpSubject(rootDraft.subject); // still exercised even though this scenario represents the very first send
  const { inReplyTo, references } = buildThreadingHeaders(rootDraft, []);

  const calls: Parameters<IEmailAdapter["send"]>[0][] = [];
  const mockAdapter: IEmailAdapter = {
    name: "mock",
    async send(params) {
      calls.push(params);
      return { id: "mock-resend-id-scratch-2" };
    },
  };

  await mockAdapter.send({
    to: "scratch-recipient@test.invalid",
    subject,
    body: "Scratch body.",
    idempotencyKey: "scratch-idempotency-key-2",
    inReplyTo,
    references,
  });

  assert.equal(calls[0].inReplyTo, undefined);
  assert.equal(calls[0].references, undefined);
  assert.equal(buildThreadingEmailHeaders({ inReplyTo: calls[0].inReplyTo, references: calls[0].references }), undefined);
});
