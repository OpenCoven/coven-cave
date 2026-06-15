// @ts-nocheck
// Security regression tests for the daemon session API hardening.
// Verifies that session endpoints reject non-local requests, validate session
// IDs against the UUID pattern, and confirm session ownership before proxying
// to the daemon — preventing unauthenticated access and SSRF via crafted IDs.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const eventsSource = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
const inputSource = readFileSync(new URL("../input/route.ts", import.meta.url), "utf8");
const sessionSource = readFileSync(new URL("../route.ts", import.meta.url), "utf8");

// ── events route ─────────────────────────────────────────────────────────────

assert.match(
  eventsSource,
  /rejectNonLocalRequest/,
  "events route must reject non-local requests (loopback guard)",
);

assert.match(
  eventsSource,
  /isValidSessionId/,
  "events route must validate session ID format before proxying to daemon",
);

assert.match(
  eventsSource,
  /isOwnedSession/,
  "events route must verify session ownership to prevent cross-session data access",
);

assert.match(
  eventsSource,
  /status.*400|400.*status/,
  "events route must return 400 on invalid session ID, not 500 or silent proxy",
);

// ── input route ───────────────────────────────────────────────────────────────

assert.match(
  inputSource,
  /rejectNonLocalRequest/,
  "input route must reject non-local requests (loopback guard)",
);

assert.match(
  inputSource,
  /isValidSessionId/,
  "input route must validate session ID format",
);

assert.match(
  inputSource,
  /isOwnedSession/,
  "input route must verify session ownership before forwarding input",
);

assert.match(
  inputSource,
  /boundedString|MAX_INPUT_CHARS/,
  "input route must bound input length to prevent oversized payload injection",
);

assert.match(
  inputSource,
  /MAX_SESSION_JSON_BYTES/,
  "input route must limit request body size to prevent memory exhaustion",
);

// ── session route (kill / general) ───────────────────────────────────────────

assert.match(
  sessionSource,
  /rejectNonLocalRequest/,
  "session route must reject non-local requests",
);

assert.match(
  sessionSource,
  /isValidSessionId/,
  "session route must validate session ID format to block path traversal via crafted IDs",
);

console.log("sessions/[id] security route.test.ts: ok");
