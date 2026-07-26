import assert from "node:assert/strict";
import {
  classifySetupFailure,
  setupRetryLabel,
} from "./onboarding-setup-failure.ts";

// ── Message handling ─────────────────────────────────────────────────────────
assert.equal(
  classifySetupFailure("scaffold", new Error("EACCES: permission denied, mkdir '/Users/x/.coven'")).message,
  "EACCES: permission denied, mkdir '/Users/x/.coven'",
  "the raw message is kept verbatim for diagnostics",
);
assert.equal(
  classifySetupFailure("daemon-start", "").message,
  "daemon start failed",
  "an empty message falls back to the action's generic description",
);
assert.equal(
  classifySetupFailure("connection-save", undefined).message,
  "connection setup failed",
  "a non-string failure falls back to the action's generic description",
);

// ── Taxonomy: each covered failure class yields one actionable hint ──────────
const cliMissing = classifySetupFailure(
  "daemon-start",
  "Coven CLI not found on PATH. Open Setup to install it, then try again.",
);
assert.match(
  cliMissing.hint ?? "",
  /step 1 \(Install the Coven CLI\), then retry/,
  "a missing coven binary routes the user to the CLI step",
);

const permission = classifySetupFailure(
  "scaffold",
  "EACCES: permission denied, mkdir '/Users/x/.coven'",
);
assert.match(
  permission.hint ?? "",
  /ownership and permissions of ~\/.coven/,
  "permission failures explain the ~/.coven ownership fix",
);

const portHeld = classifySetupFailure("daemon-start", "listen EADDRINUSE: address already in use");
assert.match(
  portHeld.hint ?? "",
  /Another process is holding the daemon's socket or port/,
  "a held socket/port names the actual blocker",
);

const diskFull = classifySetupFailure("scaffold", "ENOSPC: no space left on device");
assert.match(diskFull.hint ?? "", /disk is full/i, "ENOSPC maps to a disk-full hint");

const daemonTimeout = classifySetupFailure("daemon-start", "timeout");
assert.match(
  daemonTimeout.hint ?? "",
  /didn't come up within its start window/,
  "a daemon start timeout explains warm-up and the retry path",
);

const transport = classifySetupFailure("scaffold", "Failed to fetch");
assert.match(
  transport.hint ?? "",
  /local server didn't answer/,
  "a dead sidecar maps to a restart-Cave hint",
);

const badConnection = classifySetupFailure("connection-save", "hubUrl must be a valid http(s) URL");
assert.match(
  badConnection.hint ?? "",
  /hub URL and executor URLs/,
  "connection validation failures point at the URL fields",
);

// Unclassifiable messages keep hint=null — the banner then shows only the raw
// message plus the retry affordance, never an invented hint.
assert.equal(
  classifySetupFailure("scaffold", "something inscrutable").hint,
  null,
  "unknown failures never fabricate a hint",
);

// ── Retry labels ─────────────────────────────────────────────────────────────
assert.equal(setupRetryLabel("scaffold"), "Retry creating Coven home");
assert.equal(setupRetryLabel("daemon-start"), "Retry daemon start");
assert.equal(setupRetryLabel("connection-save"), "Retry saving connection");

console.log("onboarding-setup-failure.test.ts: ok");
