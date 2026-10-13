/**
 * Canonical browser URL used in outbound email. Production must never fall
 * back to a Replit development domain or localhost.
 */
export function getAppUrl(): string {
  const domain = (process.env.REPLIT_DOMAINS || process.env.REPLIT_DEV_DOMAIN || "")
    .split(",")[0]?.trim();
  // A shared production APP_URL must not send development password-reset
  // links to the real site.
  if (process.env.NODE_ENV !== "production" && domain) return `https://${domain}`;

  const configured = process.env.APP_URL?.trim();
  if (configured) {
    const url = new URL(configured);
    if (
      (process.env.NODE_ENV === "production" && url.protocol !== "https:") ||
      !["http:", "https:"].includes(url.protocol) ||
      url.username || url.password || url.pathname !== "/" || url.search || url.hash
    ) {
      throw new Error("APP_URL must be an HTTPS origin in production");
    }
    return url.origin;
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("APP_URL is required for production email links");
  }
  return "http://localhost:5000";
}