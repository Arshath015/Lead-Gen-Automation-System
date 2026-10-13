import { test } from "node:test";
import assert from "node:assert/strict";
import { locationSuffix } from "./engagementPipeline";

test("locationSuffix: no location at all -> empty string", () => {
  assert.equal(locationSuffix(null), "");
});

test("locationSuffix: proxied location (all geo fields null) -> explicit unavailable-because-proxy wording, not silently empty", () => {
  const suffix = locationSuffix({ country: null, region: null, city: null, approximate: true, likelyProxied: true });
  assert.equal(suffix, " (location unavailable — routed through an email provider proxy)");
});

test("locationSuffix: genuine non-proxied location renders the approximate location", () => {
  const suffix = locationSuffix({ country: "India", region: "Tamil Nadu", city: "Madurai", approximate: true, likelyProxied: false });
  assert.equal(suffix, " (approx. Madurai, Tamil Nadu, India)");
});

test("locationSuffix: non-proxied but genuinely unresolved (no geo fields) -> empty string, not a false proxy claim", () => {
  const suffix = locationSuffix({ country: null, region: null, city: null, approximate: true, likelyProxied: false });
  assert.equal(suffix, "");
});
