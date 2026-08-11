// @ts-nocheck
//
// The proxy-side half of the passkey gate (cave-brksh): which requests must
// carry a proven biometric check, plus source pins on the two files that cannot
// import from each other — server.ts mints the per-boot presence secret and
// esbuild emits it with --bundle=false, so it can never import from src/.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { requiresPasskeyPresence } from "./proxy-helpers.ts";

const proxySource = readFileSync(new URL("./proxy.ts", import.meta.url), "utf8");
const serverSource = readFileSync(new URL("../server.ts", import.meta.url), "utf8");

// ─── requiresPasskeyPresence ───────────────────────────────────────────────

assert.equal(
  requiresPasskeyPresence("/api/board", true, true),
  true,
  "an ordinary API call over remote ingress needs presence when armed",
);

assert.equal(
  requiresPasskeyPresence("/api/board", true, false),
  false,
  "disarmed is the default and must gate nothing",
);

assert.equal(
  requiresPasskeyPresence("/api/board", false, true),
  false,
  "a direct loopback peer is someone at the machine; the phone is the subject here",
);

assert.equal(
  requiresPasskeyPresence("/chat", true, true),
  false,
  "page navigations must load or the ceremony UI can never render",
);

for (const exempt of [
  "/api/passkey",
  "/api/passkey/challenge",
  "/api/passkey/assert",
  "/api/passkey/register",
  "/api/passkey/enrolled",
]) {
  assert.equal(
    requiresPasskeyPresence(exempt, true, true),
    false,
    `${exempt} is exempt — obtaining presence cannot itself require presence`,
  );
}

assert.equal(
  requiresPasskeyPresence("/api/passkeys-elsewhere", true, true),
  true,
  "the exemption is the /api/passkey family, not any path with that prefix in its name",
);

// ─── proxy.ts wiring ───────────────────────────────────────────────────────

assert.match(
  proxySource,
  /requiresPasskeyPresence\(\s*req\.nextUrl\.pathname,\s*remoteIngress,/,
  "the gate is driven by remoteIngress, so a local peer is never asked for presence",
);

assert.match(
  proxySource,
  /presence\.tailnetNodeId !== tailnetNodeId/,
  "the node binding is re-checked against the presenting peer, not just the MAC",
);

assert.match(
  proxySource,
  /jsonError\(401, "passkey presence required"\)/,
  "a missing or unbindable presence proof fails closed with 401",
);

// The presence check must run BEFORE the request is handed to Next, and in
// particular before the marker is set — otherwise a gated request would still
// reach route handlers carrying remote-ingress authority.
assert.ok(
  proxySource.indexOf("passkey presence required") <
    proxySource.lastIndexOf("return nextWithMobileAccessMarker"),
  "the gate precedes the pass-through",
);

// ─── server.ts wiring ──────────────────────────────────────────────────────

assert.match(
  serverSource,
  /process\.env\.COVEN_CAVE_PASSKEY_SESSION_SECRET = randomUUID\(\)/,
  "the presence secret is minted per boot, so a restart invalidates every outstanding token",
);

// Count the assignments rather than pattern-matching for their absence: a
// negative lookahead after `\s*` can satisfy itself by backtracking to zero
// whitespace, so `= (?!randomUUID)` matches the very line it is meant to
// exclude. (It did, on the first run of this test.)
const presenceSecretAssignments =
  serverSource.match(/COVEN_CAVE_PASSKEY_SESSION_SECRET\s*=[^;\n]*/g) ?? [];
assert.equal(
  presenceSecretAssignments.length,
  1,
  "exactly one assignment of the presence secret — a second could reintroduce a fixed value",
);
assert.match(
  presenceSecretAssignments[0],
  /randomUUID\(\)/,
  "and that assignment mints it per boot, so a restart invalidates every outstanding token",
);
