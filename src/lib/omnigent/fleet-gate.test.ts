import test from "node:test";
import assert from "node:assert/strict";
import { isFleetTokenPresent } from "./fleet-gate.ts";

test("hidden when Omnigent is not configured", () => {
  assert.equal(
    isFleetTokenPresent({ configured: false, authenticated: true, authMode: "jwt", envInVault: true }),
    false,
  );
  assert.equal(isFleetTokenPresent({}), false);
});

test("hidden for null/undefined status payloads", () => {
  assert.equal(isFleetTokenPresent(null), false);
  assert.equal(isFleetTokenPresent(undefined), false);
});

test("hidden unless the Omnigent env is set up in the user's vault", () => {
  // Credentials from ~/.omnigent/auth_tokens.json alone (JWT/Databricks) must
  // not surface Fleet UI — the vault env is the per-user opt-in.
  for (const authMode of ["jwt", "databricks"]) {
    assert.equal(isFleetTokenPresent({ configured: true, authenticated: true, authMode }), false);
    assert.equal(
      isFleetTokenPresent({ configured: true, authenticated: true, authMode, envInVault: false }),
      false,
    );
  }
  // Fail closed on status payloads that predate the envInVault field.
  assert.equal(isFleetTokenPresent({ configured: true, authenticated: true, authMode: "env" }), false);
});

test("hidden for tokenless local mode even when status reports authenticated", () => {
  // /api/omnigent/status reports authenticated=true for authMode "none" when
  // the server is online — the gate must still hide Fleet UI without a token.
  assert.equal(
    isFleetTokenPresent({ configured: true, authenticated: true, authMode: "none", envInVault: true }),
    false,
  );
  assert.equal(isFleetTokenPresent({ configured: true, authenticated: true, envInVault: true }), false);
});

test("hidden when configured but no credential material resolved", () => {
  assert.equal(
    isFleetTokenPresent({ configured: true, authenticated: false, authMode: "jwt", envInVault: true }),
    false,
  );
});

test("shown for jwt, env, and databricks credential material when env is in the vault", () => {
  for (const authMode of ["jwt", "env", "databricks"]) {
    assert.equal(
      isFleetTokenPresent({ configured: true, authenticated: true, authMode, envInVault: true }),
      true,
    );
  }
});
