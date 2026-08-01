import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const connection = readFileSync(new URL("./connection/route.ts", import.meta.url), "utf8");
const start = readFileSync(new URL("./oauth/start/route.ts", import.meta.url), "utf8");
const connectionHandlers = readFileSync(
  new URL("../../../lib/server/x-connection-route.ts", import.meta.url),
  "utf8",
);
const oauthHandlers = readFileSync(
  new URL("../../../lib/server/x-oauth-start-route.ts", import.meta.url),
  "utf8",
);

assert.match(connection, /export async function GET\(req: Request\)/);
assert.match(connection, /export async function DELETE\(req: Request\)/);
assert.match(connection, /\brejectNonLocalRequest,\n/);
assert.match(connectionHandlers, /dependencies\.rejectNonLocalRequest\(req\)/g);
assert.match(connection, /xCredentialService\.getConnectionStatus\(\)/);
assert.match(connection, /xOAuthService\.flowStatus\(\)/);
assert.doesNotMatch(connection, /sweepExpiredXCache/);
assert.match(connectionHandlers, /oauthFlowId/);
assert.match(connectionHandlers, /oauthOutcome/);
const cancelIndex = connectionHandlers.indexOf("dependencies.cancelAll()");
const purgeIndex = connectionHandlers.indexOf("await dependencies.purgeCache()");
const disconnectIndex = connectionHandlers.indexOf("dependencies.disconnect()");
assert.ok(cancelIndex >= 0 && cancelIndex < purgeIndex && purgeIndex < disconnectIndex);
assert.match(connection, /cancelAll: \(\) => xOAuthService\.cancelAll\(\)/);
assert.match(connection, /purgeCache: \(\) => purgeXSourceCache\(\)/);
assert.match(connection, /disconnect: \(\) => xCredentialService\.disconnect\(\)/);
assert.doesNotMatch(connection, /runtime.*purge|purge.*runtime/i);
assert.match(connectionHandlers, /\{ ok: true \}/);
assert.doesNotMatch(
  connection,
  /accessToken|refreshToken|codeVerifier|\bverifier\b|pkce|oauthState/,
  "connection status must expose no token or PKCE secret",
);

assert.match(start, /export async function POST\(req: Request\)/);
assert.match(start, /\brejectNonLocalRequest,\n/);
assert.match(oauthHandlers, /dependencies\.readJsonBody\(req, MAX_BODY_BYTES\)/);
assert.match(oauthHandlers, /capability !== "research" && capability !== "publish"/);
assert.match(start, /flowId/);
assert.match(start, /start: \(input\) => xOAuthService\.start\(input\)/);
assert.match(start, /export async function DELETE\(req: Request\)/);
assert.match(start, /xOAuthService\.cancel\(flowId\)/);
assert.doesNotMatch(start, /xOAuthService\.cancel\(\)/);
assert.doesNotMatch(start, /sweepExpiredXCache/);

const {
  createXConnectionRouteHandlers,
} = await import("../../../lib/server/x-connection-route.ts");
const {
  createXOAuthStartRouteHandlers,
} = await import("../../../lib/server/x-oauth-start-route.ts");

test("connection status and OAuth start do not touch an unhealthy cache", async () => {
  const connectionHandlers = createXConnectionRouteHandlers({
    rejectNonLocalRequest: () => null,
    configured: () => true,
    getConnectionStatus: () => ({ connected: false }),
    flowStatus: () => ({ activeFlow: false }),
    cancelAll: () => {},
    purgeCache: async () => {
      throw new Error("must not run during status");
    },
    disconnect: () => {},
  });
  const status = await connectionHandlers.GET(new Request("http://127.0.0.1/api/x/connection"));
  assert.equal(status.status, 200);

  const oauthHandlers = createXOAuthStartRouteHandlers({
    rejectNonLocalRequest: () => null,
    readJsonBody: async () => ({
      ok: true,
      body: { capability: "research", flowId: "a".repeat(43) },
    }),
    start: async () => ({
      flowId: "a".repeat(43),
      authorizationUrl: "https://x.com/i/oauth2/authorize",
      requestedScopes: ["tweet.read", "users.read", "offline.access"],
      expiresAt: "2026-07-31T12:10:00.000Z",
    }),
    cancel: () => true,
  });
  const started = await oauthHandlers.POST(new Request("http://127.0.0.1/api/x/oauth/start", {
    method: "POST",
  }));
  assert.equal(started.status, 200);
});

test("disconnect purge failure returns an error and preserves credentials", async () => {
  let connected = true;
  const calls: string[] = [];
  const handlers = createXConnectionRouteHandlers({
    rejectNonLocalRequest: () => null,
    configured: () => true,
    getConnectionStatus: () => connected
      ? {
          connected: true,
          expiresAt: "2026-07-31T13:00:00.000Z",
          scopes: [],
          account: { id: "42", username: "cave", name: "Cave" },
        }
      : { connected: false },
    flowStatus: () => ({ activeFlow: true }),
    cancelAll: () => {
      calls.push("cancel");
    },
    purgeCache: async () => {
      calls.push("purge");
      throw new Error("cache permission denied");
    },
    disconnect: () => {
      calls.push("disconnect");
      connected = false;
    },
  });

  const response = await handlers.DELETE(new Request("http://127.0.0.1/api/x/connection", {
    method: "DELETE",
  }));
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: "X connection could not be disconnected",
  });
  assert.equal(connected, true);
  assert.deepEqual(calls, ["cancel", "purge"]);
});

test("successful disconnect cancels OAuth, purges cache, then deletes credentials", async () => {
  let connected = true;
  const calls: string[] = [];
  const handlers = createXConnectionRouteHandlers({
    rejectNonLocalRequest: () => null,
    configured: () => true,
    getConnectionStatus: () => connected
      ? {
          connected: true,
          expiresAt: "2026-07-31T13:00:00.000Z",
          scopes: [],
          account: { id: "42", username: "cave", name: "Cave" },
        }
      : { connected: false },
    flowStatus: () => ({ activeFlow: true }),
    cancelAll: () => {
      calls.push("cancel");
    },
    purgeCache: async () => {
      calls.push("purge");
    },
    disconnect: () => {
      calls.push("disconnect");
      connected = false;
    },
  });

  const response = await handlers.DELETE(new Request("http://127.0.0.1/api/x/connection", {
    method: "DELETE",
  }));
  assert.equal(response.status, 200);
  assert.equal(connected, false);
  assert.deepEqual(calls, ["cancel", "purge", "disconnect"]);
});

console.log("account-routes.test.ts: ok");
