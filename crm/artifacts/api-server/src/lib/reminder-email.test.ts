import { beforeEach, describe, expect, it, vi } from "vitest";

const fakeResend = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: fakeResend.send };
  },
}));
vi.mock("./app-url", () => ({ getAppUrl: () => "https://example.test" }));

import { sendFollowupReminderEmail } from "./email";

const args = [
  "qa@example.test", "QA", "Test Company", "Test Contact",
  new Date("2026-09-29T12:00:00Z"), 123, "stable-reminder-key",
] as const;

describe("Resend reminder delivery", () => {
  beforeEach(() => {
    vi.stubEnv("RESEND_API_KEY", "mocked-test-key");
    fakeResend.send.mockReset();
  });
  it("passes the stable provider idempotency key and accepts success", async () => {
    fakeResend.send.mockResolvedValue({ data: { id: "mock-id" }, error: null });
    await expect(sendFollowupReminderEmail(...args)).resolves.toBeUndefined();
    expect(fakeResend.send).toHaveBeenCalledOnce();
    expect(fakeResend.send.mock.calls[0][1]).toEqual({ idempotencyKey: "stable-reminder-key" });
  });
  it("turns a Resend error response into a retryable failure", async () => {
    fakeResend.send.mockResolvedValue({ data: null, error: { message: "temporarily unavailable" } });
    await expect(sendFollowupReminderEmail(...args)).rejects.toThrow("temporarily unavailable");
  });
  it("fails explicitly without credentials instead of reporting success", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    await expect(sendFollowupReminderEmail(...args)).rejects.toThrow("RESEND_API_KEY");
    expect(fakeResend.send).not.toHaveBeenCalled();
  });
});