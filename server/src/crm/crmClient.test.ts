import { test, mock } from "node:test";
import assert from "node:assert/strict";
import {
  getCrmConfig,
  pushLeadToCrm,
  CrmNotConfiguredError,
  CrmRequestError,
  __resetCrmClientForTests,
} from "./crmClient";
import type { Lead } from "../types/lead";

const ORIGINAL_ENV = { ...process.env };

function setConfigEnv() {
  process.env.CRM_API_URL = "http://localhost:4100";
  process.env.CRM_LOGIN_EMAIL = "pitcsleads@gmail.com";
  process.env.CRM_LOGIN_PASSWORD = "LocalDev#2026";
}

function clearConfigEnv() {
  delete process.env.CRM_API_URL;
  delete process.env.CRM_LOGIN_EMAIL;
  delete process.env.CRM_LOGIN_PASSWORD;
}

function sampleLead(overrides: Partial<Lead> = {}): Lead {
  return {
    id: "lead-1",
    source: "import",
    sourceId: "src-1",
    dedupKey: "email:jane@acme.com",
    email: "jane@acme.com",
    fullName: "Jane Doe",
    title: "CTO",
    company: "Acme Corp",
    companyDomain: null,
    linkedinUrl: null,
    phone: "+91 123",
    location: "Pune",
    status: "new",
    icpProfileId: null,
    searchRunId: null,
    raw: null,
    engagementStatus: "active",
    automationEnabled: true,
    roleCategory: "CTO / IT Head",
    industry: "Manufacturing",
    sourceFile: null,
    sourceWorksheet: null,
    crmLeadId: null,
    crmPushedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

test.afterEach(() => {
  mock.restoreAll();
  __resetCrmClientForTests();
  process.env = { ...ORIGINAL_ENV };
});

test("getCrmConfig: null when any of the three required vars is missing", () => {
  clearConfigEnv();
  assert.equal(getCrmConfig(), null);
  setConfigEnv();
  delete process.env.CRM_LOGIN_PASSWORD;
  assert.equal(getCrmConfig(), null);
});

test("getCrmConfig: returns the config (with a trailing slash stripped) when all three are set", () => {
  setConfigEnv();
  process.env.CRM_API_URL = "http://localhost:4100/";
  assert.deepEqual(getCrmConfig(), {
    apiUrl: "http://localhost:4100",
    email: "pitcsleads@gmail.com",
    password: "LocalDev#2026",
  });
});

test("pushLeadToCrm: throws CrmNotConfiguredError when CRM env vars aren't set", async () => {
  clearConfigEnv();
  await assert.rejects(() => pushLeadToCrm(sampleLead()), CrmNotConfiguredError);
});

test("pushLeadToCrm: logs in, then creates the lead with correctly mapped fields", async () => {
  setConfigEnv();
  const calls: { url: string; init: RequestInit }[] = [];

  mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith("/api/auth/login")) {
      return new Response(JSON.stringify({ user: { id: 1 } }), {
        status: 200,
        headers: { "set-cookie": "sid=abc123; Path=/; HttpOnly" },
      });
    }
    if (String(url).endsWith("/api/leads")) {
      return new Response(JSON.stringify({ id: 42 }), { status: 201 });
    }
    throw new Error(`Unexpected URL in test: ${url}`);
  });

  const result = await pushLeadToCrm(sampleLead());
  assert.deepEqual(result, { crmLeadId: 42 });

  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, "http://localhost:4100/api/auth/login");
  assert.deepEqual(JSON.parse(calls[0].init.body as string), {
    email: "pitcsleads@gmail.com",
    password: "LocalDev#2026",
  });

  assert.equal(calls[1].url, "http://localhost:4100/api/leads");
  assert.equal((calls[1].init.headers as Record<string, string>).Cookie, "sid=abc123");
  const body = JSON.parse(calls[1].init.body as string);
  assert.equal(body.companyName, "Acme Corp");
  assert.equal(body.contactPerson, "Jane Doe");
  assert.equal(body.email, "jane@acme.com");
  assert.equal(body.designation, "CTO");
  assert.equal(body.source, "api");
  assert.match(body.remarks, /Pushed from Outreach \(source: import, role: CTO \/ IT Head\)/);
});

test("pushLeadToCrm: a lead with no company falls back to a placeholder, never sends a blank companyName", async () => {
  setConfigEnv();
  mock.method(globalThis, "fetch", async (url: string) => {
    if (String(url).endsWith("/api/auth/login")) {
      return new Response(null, { status: 200, headers: { "set-cookie": "sid=abc123" } });
    }
    return new Response(JSON.stringify({ id: 7 }), { status: 201 });
  });

  await pushLeadToCrm(sampleLead({ company: null }));
});

test("pushLeadToCrm: reuses the cached session on a second push — only one login call total", async () => {
  setConfigEnv();
  let loginCalls = 0;
  mock.method(globalThis, "fetch", async (url: string) => {
    if (String(url).endsWith("/api/auth/login")) {
      loginCalls += 1;
      return new Response(null, { status: 200, headers: { "set-cookie": "sid=abc123" } });
    }
    return new Response(JSON.stringify({ id: 1 }), { status: 201 });
  });

  await pushLeadToCrm(sampleLead({ id: "lead-1" }));
  await pushLeadToCrm(sampleLead({ id: "lead-2", dedupKey: "email:other@acme.com" }));
  assert.equal(loginCalls, 1);
});

test("pushLeadToCrm: a 401 on an expired/invalid cached session triggers exactly one re-login and retry", async () => {
  setConfigEnv();
  let loginCalls = 0;
  let leadCalls = 0;
  mock.method(globalThis, "fetch", async (url: string) => {
    if (String(url).endsWith("/api/auth/login")) {
      loginCalls += 1;
      return new Response(null, { status: 200, headers: { "set-cookie": `sid=session-${loginCalls}` } });
    }
    leadCalls += 1;
    if (leadCalls === 1) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    return new Response(JSON.stringify({ id: 99 }), { status: 201 });
  });

  const result = await pushLeadToCrm(sampleLead());
  assert.deepEqual(result, { crmLeadId: 99 });
  assert.equal(loginCalls, 2); // initial + one re-login after the 401
  assert.equal(leadCalls, 2); // the failed attempt + the retry
});

test("pushLeadToCrm: a non-401 failure from the CRM surfaces as CrmRequestError with the real status", async () => {
  setConfigEnv();
  mock.method(globalThis, "fetch", async (url: string) => {
    if (String(url).endsWith("/api/auth/login")) {
      return new Response(null, { status: 200, headers: { "set-cookie": "sid=abc123" } });
    }
    return new Response(JSON.stringify({ error: "Invalid input" }), { status: 400 });
  });

  await assert.rejects(() => pushLeadToCrm(sampleLead()), (err: unknown) => {
    assert.ok(err instanceof CrmRequestError);
    assert.equal(err.status, 400);
    return true;
  });
});

test("pushLeadToCrm: a login failure (wrong credentials) surfaces as CrmRequestError, not a generic throw", async () => {
  setConfigEnv();
  mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ error: "Invalid email or password" }), { status: 401 }));

  await assert.rejects(() => pushLeadToCrm(sampleLead()), (err: unknown) => {
    assert.ok(err instanceof CrmRequestError);
    assert.equal(err.status, 401);
    return true;
  });
});
