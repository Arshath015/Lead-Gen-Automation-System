import { test } from "node:test";
import assert from "node:assert/strict";
import { buildThreadingEmailHeaders } from "./resendAdapter";

test("buildThreadingEmailHeaders: omits headers entirely when nothing is threaded", () => {
  assert.equal(buildThreadingEmailHeaders({}), undefined);
});

test("buildThreadingEmailHeaders: sets In-Reply-To only", () => {
  const headers = buildThreadingEmailHeaders({ inReplyTo: "<root@amazonses.com>" });
  assert.deepEqual(headers, { "In-Reply-To": "<root@amazonses.com>" });
});

test("buildThreadingEmailHeaders: sets References only, space-joined", () => {
  const headers = buildThreadingEmailHeaders({ references: ["<a@amazonses.com>", "<b@amazonses.com>"] });
  assert.deepEqual(headers, { References: "<a@amazonses.com> <b@amazonses.com>" });
});

test("buildThreadingEmailHeaders: sets both In-Reply-To and References together", () => {
  const headers = buildThreadingEmailHeaders({
    inReplyTo: "<b@amazonses.com>",
    references: ["<a@amazonses.com>", "<b@amazonses.com>"],
  });
  assert.deepEqual(headers, {
    "In-Reply-To": "<b@amazonses.com>",
    References: "<a@amazonses.com> <b@amazonses.com>",
  });
});

test("buildThreadingEmailHeaders: an empty references array is treated as absent", () => {
  assert.equal(buildThreadingEmailHeaders({ references: [] }), undefined);
});
