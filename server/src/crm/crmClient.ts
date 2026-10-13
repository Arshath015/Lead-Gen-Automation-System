import type { Lead } from "../types/lead";

// Server-to-server client for the separate Lead CRM ("Rapport" — see
// CRM_INTEGRATION_OVERVIEW.pdf). Entirely optional:
// every config value here is read directly from process.env rather than
// through config/env.ts's required() helper, so a server with no CRM
// configured still starts and runs exactly as before — only the "Send to
// CRM" action (leads.routes.ts) ever touches this module.
//
// The CRM's own auth is session/cookie-based (see its routes/auth.ts) with
// no separate API-key concept, so this logs in once with a CRM user's real
// email/password (configured below) and reuses that session's cookie for
// every subsequent call, transparently re-logging in on a 401.

export interface CrmConfig {
  apiUrl: string;
  email: string;
  password: string;
}

export function getCrmConfig(): CrmConfig | null {
  const apiUrl = process.env.CRM_API_URL;
  const email = process.env.CRM_LOGIN_EMAIL;
  const password = process.env.CRM_LOGIN_PASSWORD;
  if (!apiUrl || !email || !password) return null;
  return { apiUrl: apiUrl.replace(/\/+$/, ""), email, password };
}

export class CrmNotConfiguredError extends Error {
  constructor() {
    super("CRM integration is not configured (CRM_API_URL / CRM_LOGIN_EMAIL / CRM_LOGIN_PASSWORD).");
    this.name = "CrmNotConfiguredError";
  }
}

export class CrmRequestError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "CrmRequestError";
  }
}

let cachedSid: string | null = null;

// Test-only: forces the next call to re-login instead of reusing whatever
// session happens to still be cached from an earlier test in the same file.
export function __resetCrmClientForTests(): void {
  cachedSid = null;
}

function extractSid(res: Response): string | null {
  const cookies = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  const all = cookies.length > 0 ? cookies : [res.headers.get("set-cookie") ?? ""];
  for (const c of all) {
    const match = c.match(/(?:^|;\s*)sid=([^;]+)/);
    if (match) return match[1];
  }
  return null;
}

async function login(config: CrmConfig): Promise<string> {
  const res = await fetch(`${config.apiUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-CSRF-Protection": "1" },
    body: JSON.stringify({ email: config.email, password: config.password }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new CrmRequestError(res.status, `CRM login failed: HTTP ${res.status} ${body}`);
  }
  const sid = extractSid(res);
  if (!sid) throw new CrmRequestError(res.status, "CRM login succeeded but returned no session cookie");
  return sid;
}

async function getSid(config: CrmConfig): Promise<string> {
  if (!cachedSid) cachedSid = await login(config);
  return cachedSid;
}

// Issues one request with the cached session; on a 401 (expired/invalid
// session) logs in exactly once more and retries, rather than looping.
async function requestWithSession(
  config: CrmConfig,
  path: string,
  init: { method: string; body?: unknown }
): Promise<Response> {
  const attempt = async (sid: string) =>
    fetch(`${config.apiUrl}${path}`, {
      method: init.method,
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Protection": "1",
        Cookie: `sid=${sid}`,
      },
      body: init.body != null ? JSON.stringify(init.body) : undefined,
    });

  let sid = await getSid(config);
  let res = await attempt(sid);
  if (res.status === 401) {
    cachedSid = null;
    sid = await getSid(config);
    res = await attempt(sid);
  }
  return res;
}

export interface CreateCrmLeadResult {
  crmLeadId: number;
}

// Maps our Lead shape onto the CRM's CreateLeadBody (see
// lib/api-zod/src/generated/api.ts in the CRM repo). companyName/
// contactPerson are the CRM's only required fields; contactPerson always
// has a value (Lead.fullName is non-null), companyName falls back to a
// placeholder since Lead.company can be null (e.g. a sparse import row).
function toCreateLeadBody(lead: Lead) {
  const provenance = [
    `Pushed from Outreach (source: ${lead.source}${lead.roleCategory ? `, role: ${lead.roleCategory}` : ""}).`,
    lead.status !== "new" ? `Qualification status at push time: ${lead.status}.` : null,
  ]
    .filter(Boolean)
    .join(" ");

  return {
    companyName: lead.company ?? "Unknown Company",
    contactPerson: lead.fullName,
    email: lead.email ?? undefined,
    phone: lead.phone ?? undefined,
    location: lead.location ?? undefined,
    designation: lead.title ?? undefined,
    industry: lead.industry ?? undefined,
    linkedinUrl: lead.linkedinUrl ?? undefined,
    source: "api" as const,
    remarks: provenance,
  };
}

export async function pushLeadToCrm(lead: Lead): Promise<CreateCrmLeadResult> {
  const config = getCrmConfig();
  if (!config) throw new CrmNotConfiguredError();

  const res = await requestWithSession(config, "/api/leads", {
    method: "POST",
    body: toCreateLeadBody(lead),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new CrmRequestError(res.status, `CRM lead creation failed: HTTP ${res.status} ${body}`);
  }

  const dto = (await res.json()) as { id: number };
  return { crmLeadId: dto.id };
}
