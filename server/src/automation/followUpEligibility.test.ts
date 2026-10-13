import { test } from "node:test";
import assert from "node:assert/strict";
import { computeFollowUpDueReason } from "./followUpEligibility";
import type { EmailAutomationSettings } from "../types/automation";
import type { Lead } from "../types/lead";
import type { EmailDraft } from "../types/email";
import type { FollowUpMessage } from "../types/automation";

// Monday, within the default sending window (9-17) and default sending
// days (Mon-Fri) — the "everything is fine" baseline every test overrides
// from.
const WITHIN_WINDOW = new Date(2026, 8, 21, 10, 0, 0);
// Sunday — outside the default Mon-Fri sendingDays.
const OUTSIDE_WINDOW_DAY = new Date(2026, 8, 20, 10, 0, 0);
// Monday, 8pm — outside the default 9-17 sendingHours.
const OUTSIDE_WINDOW_HOUR = new Date(2026, 8, 21, 20, 0, 0);

function makeSettings(overrides: Partial<EmailAutomationSettings> = {}): EmailAutomationSettings {
  return {
    paused: false,
    autoDraftEnabled: false,
    autoSendEnabled: false,
    autoFollowUpEnabled: true,
    dailySendLimit: 20,
    delayBetweenEmailsMinutes: 5,
    sendingDays: [1, 2, 3, 4, 5],
    sendingHourStart: 9,
    sendingHourEnd: 17,
    followUpCount: 2,
    followUpDelayDays: 2,
    emailSignature: "",
    updatedAt: new Date(0).toISOString(),
    ...overrides,
  };
}

function makeLead(overrides: Partial<Lead> = {}): Lead {
  return {
    id: "lead-1",
    source: "manual",
    sourceId: "src-1",
    dedupKey: "email:lead@example.com",
    email: "lead@example.com",
    fullName: "Test Lead",
    title: null,
    company: null,
    companyDomain: null,
    linkedinUrl: null,
    phone: null,
    location: null,
    status: "qualified",
    icpProfileId: null,
    searchRunId: null,
    raw: null,
    engagementStatus: "active",
    automationEnabled: true,
    roleCategory: null,
    industry: null,
    sourceFile: null,
    sourceWorksheet: null,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    ...overrides,
  };
}

function makeDraft(overrides: Partial<EmailDraft> = {}): EmailDraft {
  return {
    id: "draft-1",
    leadId: "lead-1",
    researchBriefId: null,
    subject: "Subject",
    body: "Body",
    model: null,
    editedByUser: false,
    generatedAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    sendStatus: "sent",
    sentAt: WITHIN_WINDOW.toISOString(),
    resendMessageId: null,
    smtpMessageId: null,
    sendError: null,
    sendAttempts: 1,
    lastAttemptAt: null,
    nextRetryAt: null,
    sendIdempotencyKey: null,
    ...overrides,
  };
}

function makeFollowUpMessage(overrides: Partial<FollowUpMessage> = {}): FollowUpMessage {
  return {
    id: "followup-1",
    leadId: "lead-1",
    followUpTaskId: "task-1",
    sequenceNumber: 1,
    subject: "Re: Subject",
    body: "Body",
    model: null,
    sentAt: WITHIN_WINDOW.toISOString(),
    resendMessageId: null,
    smtpMessageId: null,
    ...overrides,
  };
}

test("computeFollowUpDueReason: global automation paused wins over every other condition", () => {
  const result = computeFollowUpDueReason(makeLead(), makeSettings({ paused: true }), [], [], WITHIN_WINDOW);
  assert.equal(result.reason, "paused");
});

test("computeFollowUpDueReason: outside the configured sending days", () => {
  const result = computeFollowUpDueReason(makeLead(), makeSettings(), [], [], OUTSIDE_WINDOW_DAY);
  assert.equal(result.reason, "outside_sending_window");
});

test("computeFollowUpDueReason: outside the configured sending hours", () => {
  const result = computeFollowUpDueReason(makeLead(), makeSettings(), [], [], OUTSIDE_WINDOW_HOUR);
  assert.equal(result.reason, "outside_sending_window");
});

test("computeFollowUpDueReason: daily sending quota already reached", () => {
  const settings = makeSettings({ dailySendLimit: 1 });
  const drafts = [makeDraft({ sendStatus: "sent", sentAt: WITHIN_WINDOW.toISOString() })];
  const result = computeFollowUpDueReason(makeLead(), settings, drafts, [], WITHIN_WINDOW);
  assert.equal(result.reason, "quota_reached");
});

test("computeFollowUpDueReason: quota counts follow-up sends too, not just initial drafts", () => {
  const settings = makeSettings({ dailySendLimit: 1 });
  const followUps = [makeFollowUpMessage({ sentAt: WITHIN_WINDOW.toISOString() })];
  const result = computeFollowUpDueReason(makeLead(), settings, [], followUps, WITHIN_WINDOW);
  assert.equal(result.reason, "quota_reached");
});

test("computeFollowUpDueReason: waiting for delayBetweenEmailsMinutes to elapse since the last send", () => {
  const settings = makeSettings({ delayBetweenEmailsMinutes: 30 });
  const followUps = [makeFollowUpMessage({ sentAt: new Date(WITHIN_WINDOW.getTime() - 5 * 60_000).toISOString() })];
  const result = computeFollowUpDueReason(makeLead(), settings, [], followUps, WITHIN_WINDOW);
  assert.equal(result.reason, "waiting_for_delay");
});

test("computeFollowUpDueReason: autoFollowUpEnabled disabled in Settings", () => {
  const result = computeFollowUpDueReason(makeLead(), makeSettings({ autoFollowUpEnabled: false }), [], [], WITHIN_WINDOW);
  assert.equal(result.reason, "followup_automation_disabled");
});

test("computeFollowUpDueReason: automation disabled for this specific lead", () => {
  const lead = makeLead({ automationEnabled: false });
  const result = computeFollowUpDueReason(lead, makeSettings(), [], [], WITHIN_WINDOW);
  assert.equal(result.reason, "lead_ineligible");
});

test("computeFollowUpDueReason: lead has no revealed email address", () => {
  const lead = makeLead({ email: null });
  const result = computeFollowUpDueReason(lead, makeSettings(), [], [], WITHIN_WINDOW);
  assert.equal(result.reason, "lead_ineligible");
});

test("computeFollowUpDueReason: everything eligible -> ready, waiting for the next scheduler tick", () => {
  const result = computeFollowUpDueReason(makeLead(), makeSettings(), [], [], WITHIN_WINDOW);
  assert.equal(result.reason, "ready");
});

test("computeFollowUpDueReason: precedence — paused is reported even when the lead itself is also ineligible", () => {
  const lead = makeLead({ automationEnabled: false });
  const result = computeFollowUpDueReason(lead, makeSettings({ paused: true }), [], [], WITHIN_WINDOW);
  assert.equal(result.reason, "paused");
});
