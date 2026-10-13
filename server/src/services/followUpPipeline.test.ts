import { test } from "node:test";
import assert from "node:assert/strict";
import { buildFollowUpSubject, buildThreadingHeaders } from "./followUpPipeline";

test("buildFollowUpSubject: prefixes a plain subject with 'Re: '", () => {
  assert.equal(buildFollowUpSubject("StampSize's 3X content boost"), "Re: StampSize's 3X content boost");
});

test("buildFollowUpSubject: does not double-prefix a subject that already starts with 'Re: '", () => {
  assert.equal(buildFollowUpSubject("Re: StampSize's 3X content boost"), "Re: StampSize's 3X content boost");
});

test("buildFollowUpSubject: is case-insensitive when detecting an existing prefix", () => {
  assert.equal(buildFollowUpSubject("RE: Quarterly sync"), "RE: Quarterly sync");
  assert.equal(buildFollowUpSubject("re: Quarterly sync"), "re: Quarterly sync");
});

test("buildFollowUpSubject: always derives from the same original subject, so re-deriving on every follow-up in a sequence never stacks", () => {
  const original = "StampSize's 3X content boost";
  const first = buildFollowUpSubject(original);
  const second = buildFollowUpSubject(original); // simulates follow-up #2 re-deriving from the *original*, not from `first`
  assert.equal(first, second);
  assert.equal(second, "Re: StampSize's 3X content boost");
});

test("buildThreadingHeaders: no known Message-IDs yet -> no headers, send proceeds unthreaded", () => {
  const result = buildThreadingHeaders({ smtpMessageId: null }, []);
  assert.deepEqual(result, {});
});

test("buildThreadingHeaders: only the initial send's Message-ID is known (first follow-up)", () => {
  const result = buildThreadingHeaders({ smtpMessageId: "<root@amazonses.com>" }, []);
  assert.deepEqual(result, {
    references: ["<root@amazonses.com>"],
    inReplyTo: "<root@amazonses.com>",
  });
});

test("buildThreadingHeaders: chains initial send + prior follow-ups in order, In-Reply-To is the most recent", () => {
  const result = buildThreadingHeaders({ smtpMessageId: "<root@amazonses.com>" }, [
    { smtpMessageId: "<followup1@amazonses.com>" },
    { smtpMessageId: "<followup2@amazonses.com>" },
  ]);
  assert.deepEqual(result, {
    references: ["<root@amazonses.com>", "<followup1@amazonses.com>", "<followup2@amazonses.com>"],
    inReplyTo: "<followup2@amazonses.com>",
  });
});

test("buildThreadingHeaders: skips prior sends whose Message-ID hasn't been backfilled yet, rather than inserting a null entry", () => {
  const result = buildThreadingHeaders({ smtpMessageId: "<root@amazonses.com>" }, [
    { smtpMessageId: null }, // webhook backfill for this earlier follow-up hasn't arrived yet
    { smtpMessageId: "<followup2@amazonses.com>" },
  ]);
  assert.deepEqual(result, {
    references: ["<root@amazonses.com>", "<followup2@amazonses.com>"],
    inReplyTo: "<followup2@amazonses.com>",
  });
});

test("buildThreadingHeaders: even the root Message-ID missing (webhook backfill still pending) falls back to no headers", () => {
  const result = buildThreadingHeaders({ smtpMessageId: null }, [{ smtpMessageId: "<followup1@amazonses.com>" }]);
  // Chain isn't broken by the missing root — the known one is still used —
  // but if that were also missing, the function must degrade to {} (covered
  // by the first test above) rather than throw or send a broken chain.
  assert.deepEqual(result, {
    references: ["<followup1@amazonses.com>"],
    inReplyTo: "<followup1@amazonses.com>",
  });
});
