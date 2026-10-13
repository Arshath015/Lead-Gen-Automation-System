import { afterEach, describe, expect, it, vi } from "vitest";
import { getAppUrl } from "./app-url";

afterEach(() => vi.unstubAllEnvs());

describe("outbound email origin", () => {
  it("uses APP_URL in production even when Replit domains exist", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_URL", "https://rapport.app/");
    vi.stubEnv("REPLIT_DOMAINS", "old.replit.app");
    expect(getAppUrl()).toBe("https://rapport.app");
  });
  it("refuses missing or insecure production origins", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_URL", "");
    expect(() => getAppUrl()).toThrow("APP_URL is required");
    vi.stubEnv("APP_URL", "http://rapport.app");
    expect(() => getAppUrl()).toThrow("HTTPS origin");
  });
  it("keeps the development preview fallback", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("APP_URL", "https://rapport.app");
    vi.stubEnv("REPLIT_DOMAINS", "example.replit.dev,other.replit.dev");
    expect(getAppUrl()).toBe("https://example.replit.dev");
  });
});