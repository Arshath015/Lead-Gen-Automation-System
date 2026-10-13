import { test } from "node:test";
import assert from "node:assert/strict";
import { apolloAdapter } from "./apollo";
import type { RawSearchResult } from "./ISourceAdapter";

test("apolloAdapter: declares its capabilities", () => {
  assert.deepEqual(apolloAdapter.capabilities, ["search", "revealContact"]);
});

test("apolloAdapter: isConfigured() reflects that APOLLO_API_KEY is present (real .env, required() already validated it at import time)", () => {
  assert.equal(apolloAdapter.isConfigured(), true);
});

test("apolloAdapter.normalize: revealed lead with an email dedups by email", () => {
  const raw: RawSearchResult = {
    sourceId: "apollo-id-1",
    raw: {
      id: "apollo-id-1",
      first_name: "Jane",
      last_name: "Doe",
      email: "jane.doe@example.com",
      title: "VP Engineering",
      linkedin_url: "https://www.linkedin.com/in/janedoe",
      city: "Austin",
      state: "Texas",
      country: "United States",
      organization: { name: "Acme Corp", primary_domain: "acme.com" },
    },
  };

  const lead = apolloAdapter.normalize(raw, "icp-1", "run-1");

  assert.equal(lead.source, "apollo");
  assert.equal(lead.sourceId, "apollo-id-1");
  assert.equal(lead.dedupKey, "email:jane.doe@example.com");
  assert.equal(lead.email, "jane.doe@example.com");
  assert.equal(lead.fullName, "Jane Doe");
  assert.equal(lead.title, "VP Engineering");
  assert.equal(lead.company, "Acme Corp");
  assert.equal(lead.companyDomain, "acme.com");
  assert.equal(lead.linkedinUrl, "https://www.linkedin.com/in/janedoe");
  assert.equal(lead.location, "Austin, Texas, United States");
  assert.equal(lead.icpProfileId, "icp-1");
  assert.equal(lead.searchRunId, "run-1");
});

test("apolloAdapter.normalize: unrevealed search result (no email) falls back to full name + company domain for dedup", () => {
  const raw: RawSearchResult = {
    sourceId: "apollo-id-2",
    raw: {
      id: "apollo-id-2",
      first_name: "John",
      last_name_obfuscated: "Sm**h", // Apollo masks the surname pre-reveal
      organization: { name: "Widgets Inc", website_url: "https://widgets.example" },
    },
  };

  const lead = apolloAdapter.normalize(raw, "icp-1", "run-1");

  assert.equal(lead.email, null);
  assert.equal(lead.fullName, "John Sm**h");
  assert.equal(lead.companyDomain, "https://widgets.example");
  assert.equal(lead.dedupKey, "namedomain:john sm**h:https://widgets.example");
});

test("apolloAdapter.normalize: no email, no company domain, no usable name falls back to source:sourceId and 'Unknown'", () => {
  const raw: RawSearchResult = {
    sourceId: "apollo-id-3",
    raw: { id: "apollo-id-3" },
  };

  const lead = apolloAdapter.normalize(raw, "icp-1", "run-1");

  assert.equal(lead.fullName, "Unknown");
  assert.equal(lead.companyDomain, null);
  assert.equal(lead.company, null);
  assert.equal(lead.location, null);
  assert.equal(lead.dedupKey, "apollo:apollo-id-3");
});
