import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { XApiError, type XScope } from "../x-api.ts";
import type { XCredentialService, XTokenBundle } from "./x-credentials.ts";
import { createXOAuthService } from "./x-oauth.ts";

const NOW = Date.parse("2026-07-27T12:00:00.000Z");
const RESEARCH: XScope[] = ["tweet.read", "users.read", "offline.access"];

type Callback = (request: { method?: string; url?: string }, response: {
  writeHead(status: number, headers?: Record<string, string>): void;
  end(body?: string): void;
}) => Promise<void>;

function deferredListener() {
  let callback: Callback | undefined;
  let closes = 0;
  return {
    listen: async (options: { host: string; port: number; onRequest: Callback }) => {
      assert.equal(options.host, "127.0.0.1");
      assert.equal(options.port, 1456);
      callback = options.onRequest;
      return { close: () => { closes += 1; } };
    },
    callback: () => {
      assert.ok(callback, "OAuth listener must receive a callback handler");
      return callback;
    },
    closes: () => closes,
  };
}

function credentials(initial?: XTokenBundle): XCredentialService & { replacements: XTokenBundle[] } {
  let bundle = initial;
  const replacements: XTokenBundle[] = [];
  return {
    replacements,
    getConnectionStatus: () => bundle
      ? { connected: true, expiresAt: bundle.expiresAt, scopes: [...bundle.scopes], account: { ...bundle.account } }
      : { connected: false },
    replaceBundle(next) { replacements.push(next); bundle = next; },
    getAccessToken: async () => "unused",
    forceRefresh: async () => "unused",
    disconnect: () => { bundle = undefined; },
  };
}

function response() {
  let status = 0;
  let body = "";
  return {
    response: {
      writeHead(value: number) { status = value; },
      end(value?: string) { body = value ?? ""; },
    },
    result: () => ({ status, body }),
  };
}

function service(overrides: Partial<Parameters<typeof createXOAuthService>[0]> = {}) {
  let now = NOW;
  const listener = deferredListener();
  const credentialService = credentials();
  const oauth = createXOAuthService({
    now: () => now,
    randomBytes: (size) => new Uint8Array(Array.from({ length: size }, (_, index) => index)),
    listen: listener.listen,
    exchangeAuthorizationCode: async () => ({
      accessToken: "new-access", refreshToken: "new-refresh", expiresAt: "2026-07-27T13:00:00.000Z", scopes: RESEARCH,
    }),
    fetchAccount: async () => ({ id: "42", username: "cave", name: "Cave" }),
    credentialService,
    clientId: "public-client-id",
    ...overrides,
  });
  return { oauth, listener, credentialService, advance: (milliseconds: number) => { now += milliseconds; } };
}

test("start uses 32-byte PKCE verifier entropy, S256 challenge, fixed redirect, scopes, and state", async () => {
  const requested: number[] = [];
  const { oauth } = service({
    randomBytes: (size) => {
      requested.push(size);
      return new Uint8Array(Array.from({ length: size }, (_, index) => index + 1));
    },
  });
  const result = await oauth.start({ capability: "research" });
  const authorization = new URL(result.authorizationUrl);
  const verifier = Buffer.from(Array.from({ length: 32 }, (_, index) => index + 1)).toString("base64url");
  const expectedChallenge = createHash("sha256").update(verifier).digest("base64url");
  assert.ok(requested.includes(32));
  assert.equal(authorization.origin + authorization.pathname, "https://x.com/i/oauth2/authorize");
  assert.equal(authorization.searchParams.get("response_type"), "code");
  assert.equal(authorization.searchParams.get("client_id"), "public-client-id");
  assert.equal(authorization.searchParams.get("redirect_uri"), "http://127.0.0.1:1456/x/oauth/callback");
  assert.equal(authorization.searchParams.get("scope"), RESEARCH.join(" "));
  assert.equal(authorization.searchParams.get("code_challenge"), expectedChallenge);
  assert.equal(authorization.searchParams.get("code_challenge_method"), "S256");
  assert.ok(authorization.searchParams.get("state"));
  assert.deepEqual(result.requestedScopes, RESEARCH);
  assert.equal(result.expiresAt, "2026-07-27T12:10:00.000Z");
  assert.match(result.flowId, /^[A-Za-z0-9_-]{43}$/);
  assert.deepEqual(oauth.flowStatus(), {
    activeFlow: true,
    flowId: result.flowId,
    outcome: "pending",
  });
});

test("only one flow may be active and expiry closes its listener", async () => {
  const { oauth, listener, advance } = service();
  await oauth.start({ capability: "research" });
  await assert.rejects(() => oauth.start({ capability: "publish" }), (error: unknown) => error instanceof XApiError && error.code === "oauth-in-progress");
  advance(10 * 60 * 1000 + 1);
  assert.equal(oauth.status().activeFlow, false);
  assert.equal(listener.closes(), 1);
});

test("cancelling an active flow closes its listener", async () => {
  const { oauth, listener } = service();
  const started = await oauth.start({ capability: "research" });
  oauth.cancel();
  assert.deepEqual(oauth.status(), { activeFlow: false });
  assert.deepEqual(oauth.flowStatus(), {
    activeFlow: false,
    flowId: started.flowId,
    outcome: "failed",
  });
  assert.equal(listener.closes(), 1);
});

test("cancelling while listener creation is pending prevents an orphaned flow", async () => {
  let releaseListener!: () => void;
  let markListening!: () => void;
  let closes = 0;
  const listening = new Promise<void>((resolve) => {
    markListening = resolve;
  });
  const oauth = createXOAuthService({
    now: () => NOW,
    randomBytes: (size) => new Uint8Array(size),
    listen: async () => {
      markListening();
      return new Promise((resolve) => {
        releaseListener = () => resolve({
          close: () => {
            closes += 1;
          },
        });
      });
    },
    credentialService: credentials(),
    clientId: "public-client-id",
  });

  const starting = oauth.start({ capability: "research" });
  await listening;
  oauth.cancel();
  releaseListener();

  await assert.rejects(
    starting,
    (error: unknown) => error instanceof XApiError && error.code === "oauth-expired",
  );
  assert.deepEqual(oauth.status(), { activeFlow: false });
  assert.equal(closes, 1);
});

test("rejects wrong method, path, missing code, and state mismatch without replacing credentials", async () => {
  for (const request of [
    { method: "POST", path: "/x/oauth/callback?code=code&state=STATE" },
    { method: "GET", path: "/x/oauth/not-callback?code=code&state=STATE" },
    { method: "GET", path: "/x/oauth/callback?state=STATE" },
    { method: "GET", path: "/x/oauth/callback?code=code&state=wrong-state" },
  ]) {
    const { oauth, listener, credentialService } = service();
    const started = await oauth.start({ capability: "research" });
    const state = new URL(started.authorizationUrl).searchParams.get("state")!;
    const rejected = response();
    await listener.callback()({ method: request.method, url: request.path.replace("STATE", state) }, rejected.response);
    assert.equal(rejected.result().status, 400, request.path);
    assert.equal(credentialService.replacements.length, 0, request.path);
  }
});

test("rejects an absolute callback URL from a non-loopback origin", async () => {
  const { oauth, listener, credentialService } = service();
  const started = await oauth.start({ capability: "research" });
  const state = new URL(started.authorizationUrl).searchParams.get("state")!;
  const rejected = response();
  await listener.callback()({
    method: "GET",
    url: `http://example.invalid/x/oauth/callback?code=code&state=${state}`,
  }, rejected.response);
  assert.equal(rejected.result().status, 400);
  assert.equal(credentialService.replacements.length, 0);
});

test("consumes a valid callback before exchange so a simultaneous replay cannot exchange twice", async () => {
  let releaseExchange!: () => void;
  let exchanges = 0;
  const { oauth, listener, credentialService } = service({
    exchangeAuthorizationCode: async () => {
      exchanges += 1;
      return new Promise((resolve) => {
        releaseExchange = () => resolve({
          accessToken: "new-access", refreshToken: "new-refresh", expiresAt: "2026-07-27T13:00:00.000Z", scopes: RESEARCH,
        });
      });
    },
  });
  const started = await oauth.start({ capability: "research" });
  const state = new URL(started.authorizationUrl).searchParams.get("state")!;
  const first = response();
  const firstCallback = listener.callback()({ method: "GET", url: `/x/oauth/callback?code=code&state=${state}` }, first.response);
  await Promise.resolve();
  const second = response();
  const secondCallback = listener.callback()({ method: "GET", url: `/x/oauth/callback?code=code&state=${state}` }, second.response);
  const exchangesBeforeRelease = exchanges;
  releaseExchange();
  await Promise.all([firstCallback, secondCallback]);
  assert.equal(exchangesBeforeRelease, 1);
  assert.equal(second.result().status, 400);
  assert.equal(credentialService.replacements.length, 1);
});

test("keeps a consumed callback active until its exchange finishes", async () => {
  let releaseExchange!: () => void;
  const { oauth, listener, credentialService } = service({
    exchangeAuthorizationCode: async () => new Promise((resolve) => {
      releaseExchange = () => resolve({
        accessToken: "new-access", refreshToken: "new-refresh", expiresAt: "2026-07-27T13:00:00.000Z", scopes: RESEARCH,
      });
    }),
  });
  const started = await oauth.start({ capability: "research" });
  const state = new URL(started.authorizationUrl).searchParams.get("state")!;
  const first = response();
  const callback = listener.callback()({ method: "GET", url: `/x/oauth/callback?code=code&state=${state}` }, first.response);
  await Promise.resolve();
  const activeDuringExchange = oauth.status().activeFlow;
  const startRejected = await oauth.start({ capability: "research" }).then(
    () => false,
    (error: unknown) => error instanceof XApiError && error.code === "oauth-in-progress",
  );
  releaseExchange();
  await callback;
  oauth.cancel();
  assert.equal(activeDuringExchange, true);
  assert.equal(startRejected, true);
  assert.equal(credentialService.replacements.length, 1);
  assert.equal(oauth.status().activeFlow, false);
});

test("cancelling a consumed callback prevents its late exchange from replacing credentials", async () => {
  let releaseExchange!: () => void;
  const { oauth, listener, credentialService } = service({
    exchangeAuthorizationCode: async () => new Promise((resolve) => {
      releaseExchange = () => resolve({
        accessToken: "cancelled-access",
        refreshToken: "cancelled-refresh",
        expiresAt: "2026-07-27T13:00:00.000Z",
        scopes: RESEARCH,
      });
    }),
  });
  const started = await oauth.start({ capability: "research" });
  const state = new URL(started.authorizationUrl).searchParams.get("state")!;
  const callbackResult = response();
  const callback = listener.callback()({
    method: "GET",
    url: `/x/oauth/callback?code=code&state=${state}`,
  }, callbackResult.response);
  await Promise.resolve();

  oauth.cancel();
  releaseExchange();
  await callback;

  assert.equal(callbackResult.result().status, 400);
  assert.equal(credentialService.replacements.length, 0);
  assert.deepEqual(oauth.status(), { activeFlow: false });
});

test("rejects replay and expired callbacks", async () => {
  const first = service();
  const started = await first.oauth.start({ capability: "research" });
  const state = new URL(started.authorizationUrl).searchParams.get("state")!;
  await first.listener.callback()({ method: "GET", url: `/x/oauth/callback?code=code&state=${state}` }, response().response);
  const replay = response();
  await first.listener.callback()({ method: "GET", url: `/x/oauth/callback?code=code&state=${state}` }, replay.response);
  assert.equal(replay.result().status, 400);

  const expired = service();
  const expiringStart = await expired.oauth.start({ capability: "research" });
  const expiringState = new URL(expiringStart.authorizationUrl).searchParams.get("state")!;
  expired.advance(10 * 60 * 1000 + 1);
  const rejected = response();
  await expired.listener.callback()({ method: "GET", url: `/x/oauth/callback?code=code&state=${expiringState}` }, rejected.response);
  assert.equal(rejected.result().status, 400);
  assert.equal(expired.listener.closes(), 1);
});

test("successful callback exchanges, validates account, stores only then, and closes", async () => {
  const calls: string[] = [];
  const { oauth, listener, credentialService } = service({
    exchangeAuthorizationCode: async ({ code }) => {
      calls.push(`exchange:${code}`);
      return { accessToken: "new-access", refreshToken: "new-refresh", expiresAt: "2026-07-27T13:00:00.000Z", scopes: RESEARCH };
    },
    fetchAccount: async (accessToken) => {
      calls.push(`account:${accessToken}`);
      return { id: "42", username: "cave", name: "Cave" };
    },
  });
  const started = await oauth.start({ capability: "research" });
  const state = new URL(started.authorizationUrl).searchParams.get("state")!;
  const done = response();
  await listener.callback()({ method: "GET", url: `/x/oauth/callback?code=valid-code&state=${state}` }, done.response);
  assert.deepEqual(calls, ["exchange:valid-code", "account:new-access"]);
  assert.equal(credentialService.replacements.length, 1);
  assert.equal(done.result().status, 200);
  assert.match(done.result().body, /Return to Cave/);
  assert.equal(oauth.status().activeFlow, false);
  assert.deepEqual(oauth.flowStatus(), {
    activeFlow: false,
    flowId: started.flowId,
    outcome: "succeeded",
  });
  assert.equal(listener.closes(), 1);
});

test("a failed publish scope upgrade preserves the existing credential bundle", async () => {
  const existing: XTokenBundle = {
    accessToken: "old-access", refreshToken: "old-refresh", expiresAt: "2026-07-27T13:00:00.000Z", scopes: RESEARCH,
    account: { id: "1", username: "old", name: "Old" },
  };
  const stored = credentials(existing);
  const listener = deferredListener();
  const oauth = createXOAuthService({
    now: () => NOW,
    randomBytes: (size) => new Uint8Array(size),
    listen: listener.listen,
    exchangeAuthorizationCode: async () => ({ accessToken: "new-access", refreshToken: "new-refresh", expiresAt: "2026-07-27T13:00:00.000Z", scopes: RESEARCH }),
    fetchAccount: async () => ({ id: "42", username: "cave", name: "Cave" }),
    credentialService: stored,
    clientId: "public-client-id",
  });
  const started = await oauth.start({ capability: "publish" });
  const failed = response();
  const state = new URL(started.authorizationUrl).searchParams.get("state")!;
  await listener.callback()({ method: "GET", url: `/x/oauth/callback?code=code&state=${state}` }, failed.response);
  assert.equal(failed.result().status, 400);
  assert.equal(stored.replacements.length, 0);
  assert.deepEqual(stored.getConnectionStatus(), { connected: true, expiresAt: existing.expiresAt, scopes: RESEARCH, account: existing.account });
  assert.match(failed.result().body, /Return to Cave/);
});

test("a held fixed callback port is safe and tells the operator exactly how to inspect it", async () => {
  const { oauth } = service({
    listen: async () => { throw Object.assign(new Error("address in use"), { code: "EADDRINUSE" }); },
  });
  await assert.rejects(
    () => oauth.start({ capability: "research" }),
    (error: unknown) => error instanceof XApiError
      && error.code === "oauth-port-in-use"
      && error.safeMessage === "X OAuth callback port 1456 is already in use. Run `lsof -nP -iTCP:1456 -sTCP:LISTEN` to identify the listener.",
  );
});

console.log("x-oauth.test.ts: ok");
