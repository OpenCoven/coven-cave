// cave-lsj8u: /api/x/connection and /api/x/oauth/start.
//
// NOT a restore of the same-named file on tag
// archive/cave-8i8q5-wip-2026-07-29. That version pins a contract main has
// since moved past — it asserts `xOAuthService.start({ capability })` with no
// flowId, an inline `export async function POST` in the route, and
// `xOAuthService.cancel()` with no argument, which no longer typechecks
// because cancel is keyed by flowId. Re-landing it would have re-pinned the
// stale shape it describes.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const connection = readFileSync(new URL("./connection/route.ts", import.meta.url), "utf8");
const start = readFileSync(new URL("./oauth/start/route.ts", import.meta.url), "utf8");

// --- /api/x/connection -----------------------------------------------------

assert.match(connection, /export async function GET\(req: Request\)/);
assert.match(connection, /export async function DELETE\(req: Request\)/);
assert.match(connection, /rejectNonLocalRequest\(req\)/);
assert.match(connection, /xCredentialService\.getConnectionStatus\(\)/);
assert.match(connection, /xOAuthService\.status\(\)/);
assert.match(connection, /xCredentialService\.disconnect\(\)/);

// Both callers reject the response unless these three are booleans, so they
// are the contract rather than an implementation detail.
for (const field of ["configured", "connected", "activeFlow"]) {
  assert.match(connection, new RegExp(`${field}:`), `connection must report ${field}`);
}

// Disconnect must NOT cancel an in-flight authorization. cancel is keyed by
// flowId and only that flow's owner may end it; cancelling here would let one
// caller abort another's login. DELETE /api/x/oauth/start is that path.
assert.doesNotMatch(
  connection,
  /xOAuthService\.cancel\(/,
  "disconnecting must not cancel someone else's OAuth flow",
);

// A token must never reach the client through this route.
assert.doesNotMatch(connection, /accessToken|refreshToken/);

// --- /api/x/oauth/start ----------------------------------------------------

// The handlers are built by the shared lib so they can be tested without a
// server; the route is wiring only.
assert.match(start, /createXOAuthStartRouteHandlers\(/);
assert.match(start, /export const POST = handlers\.POST/);
assert.match(
  start,
  /export const DELETE = handlers\.DELETE/,
  "DELETE cancels a flow — the archived route predates it and had no DELETE",
);
assert.match(start, /rejectNonLocalRequest/, "the local-origin guard is injected");
assert.match(start, /readJsonBody<XOAuthStartBody>/);
assert.match(
  start,
  /start:\s*\(\{ capability, flowId \}\)/,
  "start must forward flowId — a capability-only call is the stale contract",
);
assert.match(start, /cancel:\s*\(flowId\)\s*=>\s*xOAuthService\.cancel\(flowId\)/);

console.log("account-routes.test.ts: ok");
