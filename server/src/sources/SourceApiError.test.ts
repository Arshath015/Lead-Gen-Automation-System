import { test } from "node:test";
import assert from "node:assert/strict";
import { SourceApiError } from "./SourceApiError";
import { ApolloApiError } from "./apollo";

test("SourceApiError: carries source, code, and message", () => {
  const err = new SourceApiError("apollo", "SOME_CODE", "Something went wrong");
  assert.equal(err.source, "apollo");
  assert.equal(err.code, "SOME_CODE");
  assert.equal(err.message, "Something went wrong");
  assert.equal(err.name, "SourceApiError");
});

test("ApolloApiError extends SourceApiError, so generic instanceof checks still catch it", () => {
  const err = new ApolloApiError("BILLING.LIMIT.CREDITS_EXHAUSTED", "Apollo credits exhausted.");
  assert.ok(err instanceof SourceApiError);
  assert.ok(err instanceof ApolloApiError);
  assert.equal(err.source, "apollo");
  assert.equal(err.code, "BILLING.LIMIT.CREDITS_EXHAUSTED");
  // .name stays "ApolloApiError", not the base class's "SourceApiError" —
  // existing behavior (anything already checking this exact string) must be
  // unaffected by the new base class.
  assert.equal(err.name, "ApolloApiError");
});

test("ApolloApiError with a null code still carries it through as null, not undefined", () => {
  const err = new ApolloApiError(null, "Generic Apollo API error (500).");
  assert.equal(err.code, null);
  assert.ok(err instanceof SourceApiError);
});
