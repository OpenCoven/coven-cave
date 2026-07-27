import assert from "node:assert/strict";
import test from "node:test";
import { classifyTailscaleFailureKind } from "./tailscale-failure.ts";

test("classifies pairing-secret failures before other Tailscale states", () => {
  assert.equal(classifyTailscaleFailureKind("Run pnpm dev to provision the token"), "pairing-secret");
  assert.equal(classifyTailscaleFailureKind("Access token is unavailable"), "pairing-secret");
  assert.equal(classifyTailscaleFailureKind("Pairing secret could not be read"), "pairing-secret");
});

test("classifies actionable Tailscale installation and session states", () => {
  assert.equal(classifyTailscaleFailureKind("Tailscale is not installed"), "not-installed");
  assert.equal(classifyTailscaleFailureKind("Tailscale CLI not found"), "not-installed");
  assert.equal(classifyTailscaleFailureKind("Tailscale is signed out"), "signed-out");
  assert.equal(classifyTailscaleFailureKind("Tailscale is logged out"), "signed-out");

  for (const state of ["not connected", "not running", "stopped", "unreachable"]) {
    assert.equal(classifyTailscaleFailureKind(`Tailscale is ${state}`), "not-running");
  }
});

test("classifies Serve failures without treating similar words as Serve", () => {
  assert.equal(classifyTailscaleFailureKind("tailscale serve failed"), "serve-failed");
  assert.equal(classifyTailscaleFailureKind("pairing service unavailable"), "unknown");
});

test("does not classify generic failures as Tailscale state failures", () => {
  assert.equal(classifyTailscaleFailureKind("CLI not found"), "unknown");
  assert.equal(classifyTailscaleFailureKind("signed out"), "unknown");
  assert.equal(classifyTailscaleFailureKind("request failed"), "unknown");
});
