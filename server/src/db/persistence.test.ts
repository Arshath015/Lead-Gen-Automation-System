import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// Node's test runner spawns a separate process per test file, so setting
// DATA_DIR here (before dynamically importing anything that reads it) only
// ever affects this file's process — it can never point the real app, or
// any other test file, at this temp directory. This is the one thing that
// makes it safe to actually exercise the JSON-file repositories in a test
// without ever touching server/data.
let tmpDir: string;
let emailDraftsRepository: typeof import("./emailDraftsRepository")["emailDraftsRepository"];
let followUpMessagesRepository: typeof import("./followUpMessagesRepository")["followUpMessagesRepository"];

before(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "stampsize-threading-test-"));
  process.env.DATA_DIR = tmpDir;
  ({ emailDraftsRepository } = await import("./emailDraftsRepository"));
  ({ followUpMessagesRepository } = await import("./followUpMessagesRepository"));
});

after(async () => {
  delete process.env.DATA_DIR;
  await fs.rm(tmpDir, { recursive: true, force: true });
});

test("emailDraftsRepository: a newly created draft starts with smtpMessageId null", async () => {
  const draft = await emailDraftsRepository.upsert("lead-1", {
    researchBriefId: null,
    subject: "Hello",
    body: "Body",
    model: null,
    editedByUser: false,
    generatedAt: new Date().toISOString(),
  });
  assert.equal(draft.smtpMessageId, null);
});

test("emailDraftsRepository: update() persists a backfilled smtpMessageId", async () => {
  await emailDraftsRepository.upsert("lead-2", {
    researchBriefId: null,
    subject: "Hello",
    body: "Body",
    model: null,
    editedByUser: false,
    generatedAt: new Date().toISOString(),
  });
  const updated = await emailDraftsRepository.update("lead-2", { smtpMessageId: "<real@amazonses.com>" });
  assert.equal(updated?.smtpMessageId, "<real@amazonses.com>");

  const reread = await emailDraftsRepository.getByLeadId("lead-2");
  assert.equal(reread?.smtpMessageId, "<real@amazonses.com>");
});

test("emailDraftsRepository: a legacy record on disk without smtpMessageId normalizes to null on read", async () => {
  // Simulates a draft written before this field existed, bypassing the
  // repository entirely to write raw legacy-shaped JSON directly.
  const raw = JSON.parse(await fs.readFile(path.join(tmpDir, "emailDrafts.json"), "utf-8"));
  raw.push({
    id: "legacy-1",
    leadId: "lead-legacy",
    researchBriefId: null,
    subject: "Old",
    body: "Old body",
    model: null,
    editedByUser: false,
    generatedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    sendStatus: "sent",
    sentAt: new Date().toISOString(),
    resendMessageId: "legacy-resend-id",
    // smtpMessageId intentionally omitted, as a pre-migration record would be
    sendError: null,
    sendAttempts: 1,
    lastAttemptAt: null,
    nextRetryAt: null,
    sendIdempotencyKey: null,
  });
  await fs.writeFile(path.join(tmpDir, "emailDrafts.json"), JSON.stringify(raw, null, 2));

  const found = await emailDraftsRepository.getByLeadId("lead-legacy");
  assert.equal(found?.smtpMessageId, null);
});

test("followUpMessagesRepository: a newly created message starts with smtpMessageId as passed (null)", async () => {
  const message = await followUpMessagesRepository.create({
    leadId: "lead-3",
    followUpTaskId: "task-1",
    sequenceNumber: 1,
    subject: "Re: Hello",
    body: "Following up",
    model: null,
    sentAt: new Date().toISOString(),
    resendMessageId: "resend-id-1",
    smtpMessageId: null,
  });
  assert.equal(message.smtpMessageId, null);
});

test("followUpMessagesRepository: updateByResendMessageId backfills smtpMessageId onto the matching message", async () => {
  await followUpMessagesRepository.create({
    leadId: "lead-4",
    followUpTaskId: "task-2",
    sequenceNumber: 1,
    subject: "Re: Hello",
    body: "Following up",
    model: null,
    sentAt: new Date().toISOString(),
    resendMessageId: "resend-id-2",
    smtpMessageId: null,
  });

  const updated = await followUpMessagesRepository.updateByResendMessageId("resend-id-2", {
    smtpMessageId: "<followup@amazonses.com>",
  });
  assert.equal(updated?.smtpMessageId, "<followup@amazonses.com>");

  const [reread] = await followUpMessagesRepository.listByLeadId("lead-4");
  assert.equal(reread.smtpMessageId, "<followup@amazonses.com>");
});

test("followUpMessagesRepository: updateByResendMessageId returns null for an unknown resend id, and touches nothing", async () => {
  const result = await followUpMessagesRepository.updateByResendMessageId("no-such-id", {
    smtpMessageId: "<should-not-be-written@amazonses.com>",
  });
  assert.equal(result, null);
});

test("followUpMessagesRepository: listByLeadId sorts by sequenceNumber and normalizes a legacy record missing smtpMessageId", async () => {
  const raw = JSON.parse(await fs.readFile(path.join(tmpDir, "followUpMessages.json"), "utf-8"));
  raw.push(
    {
      id: "legacy-followup",
      leadId: "lead-5",
      followUpTaskId: "task-legacy",
      sequenceNumber: 2,
      subject: "Re: Old thread",
      body: "Old follow-up",
      model: null,
      sentAt: new Date().toISOString(),
      resendMessageId: "legacy-resend-id-2",
      // smtpMessageId intentionally omitted
    },
    {
      id: "seq-1",
      leadId: "lead-5",
      followUpTaskId: "task-1",
      sequenceNumber: 1,
      subject: "Re: Old thread",
      body: "First follow-up",
      model: null,
      sentAt: new Date().toISOString(),
      resendMessageId: "resend-id-seq-1",
      smtpMessageId: "<seq1@amazonses.com>",
    }
  );
  await fs.writeFile(path.join(tmpDir, "followUpMessages.json"), JSON.stringify(raw, null, 2));

  const messages = await followUpMessagesRepository.listByLeadId("lead-5");
  assert.equal(messages.length, 2);
  assert.equal(messages[0].sequenceNumber, 1);
  assert.equal(messages[1].sequenceNumber, 2);
  assert.equal(messages[1].smtpMessageId, null);
});
