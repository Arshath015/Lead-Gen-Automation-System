import { describe, expect, it } from "vitest";
import { isQuickDevLoginEnabled } from "./dev-login-guard";

const safe = {
  NODE_ENV: "development",
  ENABLE_DEV_LOGIN: "true",
  REPLIT_DEV_DOMAIN: "example.replit.dev",
  DEV_LOGIN_WORKSPACE_ID: "1",
};

describe("Quick Dev Login guard", () => {
  it("requires explicit development opt-in and a specified workspace", () => {
    expect(isQuickDevLoginEnabled(safe)).toBe(true);
    expect(isQuickDevLoginEnabled({ ...safe, ENABLE_DEV_LOGIN: undefined })).toBe(false);
    expect(isQuickDevLoginEnabled({ ...safe, DEV_LOGIN_WORKSPACE_ID: undefined })).toBe(false);
  });
  it("is unavailable in production or on a deployment, even if opted in", () => {
    expect(isQuickDevLoginEnabled({ ...safe, NODE_ENV: "production" })).toBe(false);
    expect(isQuickDevLoginEnabled({ ...safe, REPLIT_DEPLOYMENT: "1" })).toBe(false);
    expect(isQuickDevLoginEnabled({ ...safe, REPLIT_DEV_DOMAIN: undefined })).toBe(false);
  });
});