import { test } from "node:test";
import assert from "node:assert/strict";
import { getSourceAdapter, listSourceNames, sourceAdapters } from "./registry";
import { apolloAdapter } from "./apollo";

test("registry: apollo is registered", () => {
  assert.equal(getSourceAdapter("apollo"), apolloAdapter);
  assert.ok(listSourceNames().includes("apollo"));
});

test("registry: an unregistered source name returns null, not undefined or a throw", () => {
  assert.equal(getSourceAdapter("clay"), null);
  assert.equal(getSourceAdapter("sales-navigator"), null);
  assert.equal(getSourceAdapter(""), null);
});

test("registry: only apollo is registered right now — no placeholder/stub entries for unimplemented connectors", () => {
  assert.deepEqual(Object.keys(sourceAdapters), ["apollo"]);
});

test("registry: every registered adapter satisfies the full ISourceAdapter contract (capabilities, isConfigured, normalize all present)", () => {
  for (const name of listSourceNames()) {
    const adapter = getSourceAdapter(name)!;
    assert.equal(adapter.name, name);
    assert.ok(Array.isArray(adapter.capabilities) && adapter.capabilities.length > 0);
    assert.equal(typeof adapter.isConfigured, "function");
    assert.equal(typeof adapter.search, "function");
    assert.equal(typeof adapter.revealContact, "function");
    assert.equal(typeof adapter.normalize, "function");
  }
});
