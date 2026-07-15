import test from "node:test";
import assert from "node:assert/strict";
import { isFleetTokenPresent } from "./fleet-gate.ts";

test("hidden when Omnigent is not configured", () => {
  assert.equal(isFleetTokenPresent({ configured: false, authenticated: true, authMode: "jwt" }), false);
  assert.equal(isFleetTokenPresent({}), false);
});

test("hidden for null/undefined status payloads", () => {
  assert.equal(isFleetTokenPresent(null), false);
  assert.equal(isFleetTokenPresent(undefined), false);
});

test("hidden for tokenless local mode even when status reports authenticated", () => {
  // /api/omnigent/status reports authenticated=true for authMode "none" when
  // the server is online — the gate must still hide Fleet UI without a token.
  assert.equal(isFleetTokenPresent({ configured: true, authenticated: true, authMode: "none" }), false);
  assert.equal(isFleetTokenPresent({ configured: true, authenticated: true }), false);
});

test("hidden when configured but no credential material resolved", () => {
  assert.equal(isFleetTokenPresent({ configured: true, authenticated: false, authMode: "jwt" }), false);
});

test("shown for jwt, env, and databricks credential material", () => {
  for (const authMode of ["jwt", "env", "databricks"]) {
    assert.equal(isFleetTokenPresent({ configured: true, authenticated: true, authMode }), true);
  }
});
