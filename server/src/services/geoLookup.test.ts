import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { resolveApproxLocation, extractOriginatingIpFromHeaders } from "./geoLookup";

// Every test mocks global fetch — resolveApproxLocation must never make a
// real network call during this suite. Each test uses its own unique fake IP
// so the module-level 6h cache in geoLookup.ts can never leak a result from
// one test into another.
function mockIpApiResponse(body: Record<string, unknown>) {
  return mock.method(globalThis, "fetch", async () => new Response(JSON.stringify(body), { status: 200 }));
}

function mockIpApiFailure(): void {
  mock.method(globalThis, "fetch", async () => {
    throw new Error("simulated network failure");
  });
}

test.afterEach(() => {
  mock.restoreAll();
});

test("resolveApproxLocation: private/loopback IPs never trigger a lookup and resolve to null", async () => {
  const fetchMock = mock.method(globalThis, "fetch", async () => {
    throw new Error("fetch should never be called for a private IP");
  });

  for (const ip of ["127.0.0.1", "::1", "10.0.0.5", "192.168.1.1", "172.16.0.1", "172.31.255.255", "fc00::1", "fd00::1"]) {
    const result = await resolveApproxLocation(ip);
    assert.equal(result, null, `expected null for private IP ${ip}`);
  }
  assert.equal(fetchMock.mock.callCount(), 0);
});

test("resolveApproxLocation: null ip never triggers a lookup and resolves to null", async () => {
  const fetchMock = mock.method(globalThis, "fetch", async () => {
    throw new Error("fetch should never be called for a null ip");
  });
  assert.equal(await resolveApproxLocation(null), null);
  assert.equal(fetchMock.mock.callCount(), 0);
});

test("resolveApproxLocation: Gmail/Google proxy IP (the reported bug — 74.125.209.7 resolving to Mountain View) is fully withheld, not shown as the recipient's location", async () => {
  mockIpApiResponse({
    status: "success",
    country: "United States",
    regionName: "California",
    city: "Mountain View",
    isp: "Google LLC",
    org: "Google LLC",
    proxy: false,
    hosting: true,
  });

  const result = await resolveApproxLocation("74.125.209.9"); // distinct from the real reported IP, still Google-owned-shaped fixture
  assert.deepEqual(result, { country: null, region: null, city: null, approximate: true, likelyProxied: true });
});

test("resolveApproxLocation: a generic unnamed hosting/datacenter IP is treated conservatively as a proxy via the `hosting` signal alone", async () => {
  mockIpApiResponse({
    status: "success",
    country: "Germany",
    regionName: "Hesse",
    city: "Frankfurt",
    isp: "Some Unlisted Cloud Provider GmbH",
    org: "Some Unlisted Cloud Provider GmbH",
    proxy: false,
    hosting: true,
  });

  const result = await resolveApproxLocation("203.0.113.10");
  assert.equal(result?.likelyProxied, true);
  assert.equal(result?.country, null);
  assert.equal(result?.region, null);
  assert.equal(result?.city, null);
});

test("resolveApproxLocation: Apple Private Relay / Mail Privacy Protection is also fully withheld (not partially shown with a caveat)", async () => {
  mockIpApiResponse({
    status: "success",
    country: "United States",
    regionName: "California",
    city: "Cupertino",
    isp: "Apple Inc.",
    org: "Apple Inc.",
    proxy: false,
    hosting: false,
  });

  const result = await resolveApproxLocation("17.0.0.5");
  assert.deepEqual(result, { country: null, region: null, city: null, approximate: true, likelyProxied: true });
});

test("resolveApproxLocation: ip-api's own `proxy: true` flag (VPN/anonymizer) is withheld even with a residential-looking ISP name and hosting:false", async () => {
  mockIpApiResponse({
    status: "success",
    country: "Netherlands",
    regionName: "North Holland",
    city: "Amsterdam",
    isp: "Some Residential Broadband Co",
    org: "Some Residential Broadband Co",
    proxy: true,
    hosting: false,
  });

  const result = await resolveApproxLocation("198.51.100.20");
  assert.equal(result?.likelyProxied, true);
  assert.equal(result?.city, null);
});

test("resolveApproxLocation: genuine public IP (real recipient, e.g. a mobile carrier) is preserved as approximate, not proxied — the Tamil Nadu click case", async () => {
  mockIpApiResponse({
    status: "success",
    country: "India",
    regionName: "Tamil Nadu",
    city: "Madurai",
    isp: "Bharti Airtel Ltd",
    org: "Bharti Airtel Ltd",
    proxy: false,
    hosting: false,
  });

  const result = await resolveApproxLocation("49.47.241.99");
  assert.deepEqual(result, {
    country: "India",
    region: "Tamil Nadu",
    city: "Madurai",
    approximate: true,
    likelyProxied: false,
  });
});

test("resolveApproxLocation: fail-closed on a network error — never throws, resolves to null", async () => {
  mockIpApiFailure();
  const result = await resolveApproxLocation("203.0.113.55");
  assert.equal(result, null);
});

test("resolveApproxLocation: fail-closed on a non-OK HTTP response — resolves to null, not a guess", async () => {
  mock.method(globalThis, "fetch", async () => new Response("Too Many Requests", { status: 429 }));
  const result = await resolveApproxLocation("203.0.113.56");
  assert.equal(result, null);
});

test("resolveApproxLocation: fail-closed when ip-api itself reports a non-success status (e.g. rate limited/invalid query) — resolves to null", async () => {
  mockIpApiResponse({ status: "fail", message: "invalid query" });
  const result = await resolveApproxLocation("203.0.113.57");
  assert.equal(result, null);
});

test("extractOriginatingIpFromHeaders: null headers resolve to null", () => {
  assert.equal(extractOriginatingIpFromHeaders(null), null);
});

test("extractOriginatingIpFromHeaders: headers with no Received or X-Originating-IP resolve to null", () => {
  assert.equal(extractOriginatingIpFromHeaders({ Subject: "Hi", From: "a@b.com" }), null);
});

test("extractOriginatingIpFromHeaders: a single Received header's bracketed IP is extracted", () => {
  const headers = {
    Received: "from mail.example.com (mail.example.com [203.0.113.42]) by inbound.resend.com with SMTP",
  };
  assert.equal(extractOriginatingIpFromHeaders(headers), "203.0.113.42");
});

test("extractOriginatingIpFromHeaders: multiple newline-joined Received lines pick the IP from the LAST (oldest/most-origin) hop", () => {
  const headers = {
    Received: [
      "from inbound-relay.resend.com (inbound-relay.resend.com [10.0.0.5]) by mx.resend.com with SMTP",
      "from mail-relay.provider.net (mail-relay.provider.net [198.51.100.7]) by inbound-relay.resend.com with SMTP",
    ].join("\n"),
  };
  // The first line (most recent hop, closest to Resend's own inbound MX) is
  // an internal 10.x address; the true candidate is the oldest hop, last in
  // the chain.
  assert.equal(extractOriginatingIpFromHeaders(headers), "198.51.100.7");
});

test("extractOriginatingIpFromHeaders: header key matching is case-insensitive", () => {
  const headers = { received: "from host (host [203.0.113.99]) by mx with SMTP" };
  assert.equal(extractOriginatingIpFromHeaders(headers), "203.0.113.99");
});

test("extractOriginatingIpFromHeaders: falls back to X-Originating-IP when no IP is found in the Received chain", () => {
  const headers = {
    Received: "from internal-host by mx.resend.com with SMTP",
    "X-Originating-IP": "[203.0.113.77]",
  };
  assert.equal(extractOriginatingIpFromHeaders(headers), "203.0.113.77");
});

test("extractOriginatingIpFromHeaders: a Received chain with no IP literal at all and no X-Originating-IP resolves to null", () => {
  const headers = { Received: "from internal-host by mx.resend.com with SMTP" };
  assert.equal(extractOriginatingIpFromHeaders(headers), null);
});

test("extractOriginatingIpFromHeaders: a private/internal IP in the oldest hop is still returned as the candidate — rejection is resolveApproxLocation's job, not extraction's", () => {
  const headers = { Received: "from internal (internal [10.1.2.3]) by mx.resend.com with SMTP" };
  assert.equal(extractOriginatingIpFromHeaders(headers), "10.1.2.3");
});

test("resolveApproxLocation: caches a result so a repeat lookup for the same IP does not call fetch again", async () => {
  const fetchMock = mockIpApiResponse({
    status: "success",
    country: "France",
    regionName: "Ile-de-France",
    city: "Paris",
    isp: "Some Residential ISP",
    org: "Some Residential ISP",
    proxy: false,
    hosting: false,
  });

  const ip = "203.0.113.58";
  const first = await resolveApproxLocation(ip);
  const second = await resolveApproxLocation(ip);
  assert.deepEqual(first, second);
  assert.equal(fetchMock.mock.callCount(), 1);
});
