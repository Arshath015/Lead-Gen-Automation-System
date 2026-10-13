import type { ApproxLocation } from "../types/engagement";

// Best-effort, server-side-only IP -> approximate location lookup. Never
// invoked from the client and never paired with any client-side fingerprinting
// — the only IP addresses this ever sees are ones Resend already included in
// a webhook event payload (an "open" or "click" on an email we sent), which
// is provider-supplied data, not something collected from the recipient's
// browser directly.
//
// Uses ip-api.com's free, no-key HTTP endpoint. That's a reasonable default
// for a small internal CRM, but it is rate-limited (45 req/min) and HTTP-only
// on the free tier — for production-scale sending volume, swap this for a
// paid IP geolocation provider (or a self-hosted MaxMind GeoLite2 database)
// behind the same resolveApproxLocation signature.
const LOOKUP_URL = (ip: string) =>
  `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,message,country,regionName,city,isp,org,proxy,hosting`;

const CACHE_TTL_MS = 6 * 60 * 60_000; // 6h — IP-to-region mappings change rarely; keeps us well under rate limits on repeat opens from the same recipient.
const cache = new Map<string, { value: ApproxLocation | null; expiresAt: number }>();

// Named signatures for infrastructure known to fetch remote images —
// including our own open-tracking pixel — on the recipient's behalf, so the
// IP Resend observes belongs to that infrastructure's egress, never the
// recipient's own network. This must include Gmail: Google proxies every
// remote image loaded in a Gmail-viewed email through its own servers
// (predominantly clustered in Google's own US infrastructure, e.g. Mountain
// View), completely independent of the recipient's actual location anywhere
// in the world — unlike Apple's Private Relay, which deliberately picks an
// egress point in the user's general region, a Gmail-proxy IP carries no
// geographic relationship to the recipient at all. Kept as an explicit,
// reviewable list rather than open-ended pattern matching.
const KNOWN_PROXY_ISP_SIGNATURES = [
  "apple", // iCloud Private Relay / Mail Privacy Protection
  "icloud private relay",
  "google", // Gmail's own image-proxying infrastructure
  "googleusercontent",
  "microsoft", // Outlook/Office 365 image proxying & Safe Links
  "outlook",
  "yahoo", // Yahoo Mail image proxy
];

// A genuine recipient's own IP — home broadband, mobile carrier, corporate
// office — is essentially never reported by ip-api as `hosting: true`, since
// that field specifically means "datacenter/cloud/hosting provider," not an
// end-user connection. Virtually all image-proxying that email providers do
// (including infrastructure not on the explicit list above, e.g. a provider
// we haven't seen yet) happens from within exactly that class of
// infrastructure. Treating `hosting: true` as proxy-like even without a name
// match is the deliberately conservative choice: the cost of occasionally
// under-reporting a genuine hosted/VPN opener's real location is far smaller
// than the cost of presenting a proxy's location as if it belonged to a
// real person, which is the exact failure this function exists to prevent.
function looksLikeKnownProxyInfrastructure(isp: string, org: string, hosting: boolean): boolean {
  const combined = `${isp} ${org}`.toLowerCase();
  if (KNOWN_PROXY_ISP_SIGNATURES.some((sig) => combined.includes(sig))) return true;
  return hosting;
}

function isPrivateOrLoopback(ip: string): boolean {
  return (
    ip === "127.0.0.1" ||
    ip === "::1" ||
    /^10\./.test(ip) ||
    /^192\.168\./.test(ip) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(ip) ||
    ip.startsWith("fc") ||
    ip.startsWith("fd")
  );
}

const IPV4_LITERAL = /\b((?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3})\b/;

function findHeader(headers: Record<string, string>, name: string): string | null {
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? headers[key] : null;
}

// Best-effort candidate extraction from an inbound reply's raw email headers
// (fetched via Resend's GET /emails/receiving/{id} — the webhook payload
// itself carries no IP at all). Deliberately a heuristic, not a guarantee:
// - "Received" headers are prepended by each relay a message passes through,
//   so the oldest (closest-to-origin) hop is the LAST one in the chain. If
//   the original message had multiple "Received:" lines, Resend's flattened
//   Record<string,string> may join them with newlines under one key — this
//   splits on newlines to recover them and takes the last line's first IP
//   literal as the candidate.
// - "X-Originating-IP" is an older but still-seen header some mail systems
//   add explicitly for this purpose, used as a fallback when no IP is found
//   in the Received chain.
// This is only ever a CANDIDATE: for the common case of Gmail/Outlook/Yahoo/
// iCloud replies, every hop in the chain belongs to that provider's own
// infrastructure, never the person's own device — the caller is required to
// run whatever this returns through the same resolveApproxLocation() used
// for opens/clicks, which independently rejects private IPs and known
// mail-provider/proxy infrastructure regardless of how the IP was obtained.
export function extractOriginatingIpFromHeaders(headers: Record<string, string> | null): string | null {
  if (!headers) return null;

  const received = findHeader(headers, "received");
  const receivedLines = received
    ? received.split("\n").map((line) => line.trim()).filter(Boolean)
    : [];
  const oldestHop = receivedLines[receivedLines.length - 1] ?? null;
  const fromReceivedChain = oldestHop ? oldestHop.match(IPV4_LITERAL)?.[1] ?? null : null;
  if (fromReceivedChain) return fromReceivedChain;

  const originatingIpHeader = findHeader(headers, "x-originating-ip");
  return originatingIpHeader ? originatingIpHeader.match(IPV4_LITERAL)?.[1] ?? null : null;
}

export async function resolveApproxLocation(ip: string | null): Promise<ApproxLocation | null> {
  if (!ip || isPrivateOrLoopback(ip)) return null;

  const cached = cache.get(ip);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  let value: ApproxLocation | null = null;
  try {
    const res = await fetch(LOOKUP_URL(ip), { signal: AbortSignal.timeout(3000) });
    if (res.ok) {
      const data = (await res.json()) as {
        status: string;
        country?: string;
        regionName?: string;
        city?: string;
        isp?: string;
        org?: string;
        proxy?: boolean;
        hosting?: boolean;
      };
      if (data.status === "success") {
        const proxied = !!data.proxy || looksLikeKnownProxyInfrastructure(data.isp ?? "", data.org ?? "", !!data.hosting);
        // A proxy's IP carries no reliable geographic relationship to the
        // recipient — not city, not region, not even country (Gmail's proxy
        // fleet is predominantly US-based regardless of where the recipient
        // actually is) — so every geo field is withheld, not just city. The
        // event is still recorded as a real open/click; only "where" is
        // marked unavailable. `likelyProxied: true` is what callers use to
        // render an explicit "location unavailable — proxy" message instead
        // of silently omitting the caveat.
        value = proxied
          ? { country: null, region: null, city: null, approximate: true, likelyProxied: true }
          : { country: data.country ?? null, region: data.regionName ?? null, city: data.city ?? null, approximate: true, likelyProxied: false };
      }
    }
  } catch {
    // Network failure, timeout, or rate limit — fall through to "Unavailable"
    // rather than let a lookup failure break webhook processing.
    value = null;
  }

  cache.set(ip, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}
