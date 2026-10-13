import { test } from "node:test";
import assert from "node:assert/strict";
import { getConnectorStatuses } from "./connectors.routes";

test("getConnectorStatuses: returns exactly one entry (apollo) — no placeholder connectors", () => {
  const statuses = getConnectorStatuses();
  assert.equal(statuses.length, 1);
  assert.equal(statuses[0].name, "apollo");
});

test("getConnectorStatuses: apollo entry has the expected shape", () => {
  const [apollo] = getConnectorStatuses();
  assert.deepEqual(apollo, {
    name: "apollo",
    capabilities: ["search", "revealContact"],
    configured: true,
  });
});

test("getConnectorStatuses: response contains only name/capabilities/configured — never credentials or secrets", () => {
  for (const status of getConnectorStatuses()) {
    assert.deepEqual(Object.keys(status).sort(), ["capabilities", "configured", "name"]);
    const serialized = JSON.stringify(status).toLowerCase();
    // Defensive: whatever a connector's env var naming convention is, none
    // of those words (or an actual key-shaped value) should ever appear in
    // this DTO's JSON representation.
    assert.ok(!serialized.includes("key"));
    assert.ok(!serialized.includes("secret"));
    assert.ok(!serialized.includes("token"));
    assert.ok(!serialized.includes("password"));
  }
});

test("getConnectorStatuses: capabilities is a plain array copy, not the adapter's own live array reference", () => {
  const [apollo] = getConnectorStatuses();
  apollo.capabilities.push("mutated");
  const [apolloAgain] = getConnectorStatuses();
  assert.deepEqual(apolloAgain.capabilities, ["search", "revealContact"]);
});
