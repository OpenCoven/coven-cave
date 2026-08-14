import assert from "node:assert/strict";
import { MAX_X_JSON_BYTES, XApiError } from "../x-api.ts";
import {
  createXClient,
  exchangeXAuthorizationCode,
  type XClient,
} from "./x-client.ts";

type RecordedRequest = { url: URL; init: RequestInit };

function response(status: number, body: unknown, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function clientWith(...responses: Array<Response | Error>): {
  client: XClient;
  requests: RecordedRequest[];
} {
  const requests: RecordedRequest[] = [];
  const client = createXClient({
    clientId: "synthetic-client-id",
    now: () => Date.parse("2026-07-27T16:00:00.000Z"),
    fetch: async (input, init) => {
      requests.push({ url: new URL(String(input)), init: init ?? {} });
      const next = responses.shift();
      if (!next) throw new Error("unexpected request");
      if (next instanceof Error) throw next;
      return next;
    },
  });
  return { client, requests };
}

function assertXError(
  error: unknown,
  code: XApiError["code"],
  dispatched = false,
): boolean {
  return error instanceof XApiError
    && error.code === code
    && error.dispatched === dispatched
    && error.message === error.safeMessage;
}

function stalledBodyClient(): {
  client: XClient;
  triggerTimeout(): void;
  fetches(): number;
} {
  let timeout: (() => void) | undefined;
  let calls = 0;
  const client = createXClient({
    clientId: "synthetic-client-id",
    setTimeout: (callback) => {
      timeout = callback;
      return 1 as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimeout: () => {},
    fetch: async (_input, init) => {
      calls += 1;
      const signal = init?.signal;
      return {
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        body: new ReadableStream<Uint8Array>({
          start(controller) {
          signal?.addEventListener("abort", () => {
              controller.error(Object.assign(new Error("aborted"), { name: "AbortError" }));
          }, { once: true });
          },
        }),
      } as unknown as Response;
    },
  });
  return {
    client,
    triggerTimeout() {
      assert.ok(timeout, "the request must retain a timeout through response body consumption");
      timeout();
    },
    fetches: () => calls,
  };
}

// The public production entrypoint exists independently of injected tests.
void exchangeXAuthorizationCode;

{
  const { client, requests } = clientWith(response(200, {
    token_type: "bearer",
    access_token: "synthetic-access-token",
    refresh_token: "synthetic-refresh-token",
    expires_in: 3600,
    scope: "tweet.read users.read offline.access",
  }));
  const value = await client.exchangeXAuthorizationCode({
    code: "synthetic-code",
    codeVerifier: "synthetic-verifier",
  });
  assert.deepEqual(value, {
    accessToken: "synthetic-access-token",
    refreshToken: "synthetic-refresh-token",
    expiresAt: "2026-07-27T17:00:00.000Z",
    scopes: ["tweet.read", "users.read", "offline.access"],
  });
  assert.equal(requests.length, 1);
  assert.equal(requests[0]!.url.href, "https://api.x.com/2/oauth2/token");
  assert.equal(requests[0]!.init.method, "POST");
  assert.equal(requests[0]!.init.headers instanceof Headers ? requests[0]!.init.headers.get("content-type") : (requests[0]!.init.headers as Record<string, string>)["content-type"], "application/x-www-form-urlencoded");
  const form = new URLSearchParams(requests[0]!.init.body as string);
  assert.deepEqual([...form.entries()].sort(), [
    ["client_id", "synthetic-client-id"],
    ["code", "synthetic-code"],
    ["code_verifier", "synthetic-verifier"],
    ["grant_type", "authorization_code"],
    ["redirect_uri", "http://127.0.0.1:1456/x/oauth/callback"],
  ].sort());
}

{
  const { client, requests } = clientWith(response(200, {
    token_type: "bearer",
    access_token: "synthetic-refreshed-access-token",
    refresh_token: "synthetic-rotated-refresh-token",
    expires_in: 60,
    scope: "tweet.read users.read offline.access tweet.write",
  }));
  const value = await client.refreshXToken({ refreshToken: "synthetic-refresh-token" });
  assert.equal(value.accessToken, "synthetic-refreshed-access-token");
  assert.equal(value.refreshToken, "synthetic-rotated-refresh-token");
  assert.deepEqual(value.scopes, ["tweet.read", "users.read", "offline.access", "tweet.write"]);
  const form = new URLSearchParams(requests[0]!.init.body as string);
  assert.deepEqual([...form.entries()].sort(), [
    ["client_id", "synthetic-client-id"],
    ["grant_type", "refresh_token"],
    ["refresh_token", "synthetic-refresh-token"],
  ].sort());
}

{
  const { client, requests } = clientWith(response(200, {
    data: { id: "42", username: "synthetic_user", name: "Synthetic User" },
  }));
  assert.deepEqual(await client.fetchXAccount("synthetic-access-token"), {
    id: "42", username: "synthetic_user", name: "Synthetic User",
  });
  assert.equal(requests[0]!.url.href, "https://api.x.com/2/users/me");
  assert.equal((requests[0]!.init.headers as Record<string, string>).authorization, "Bearer synthetic-access-token");
}

const post = {
  id: "1234567890",
  text: "A synthetic X post.",
  author_id: "42",
  created_at: "2026-07-27T12:00:00.000Z",
};
const author = { id: "42", username: "synthetic_user", name: "Synthetic User" };

{
  const { client, requests } = clientWith(response(200, { data: post, includes: { users: [author] } }));
  assert.deepEqual(await client.lookupXPost("synthetic-access-token", "1234567890"), {
    id: "1234567890",
    canonicalUrl: "https://x.com/synthetic_user/status/1234567890",
    text: "A synthetic X post.",
    author,
    createdAt: "2026-07-27T12:00:00.000Z",
  });
  assert.equal(requests[0]!.url.pathname, "/2/tweets/1234567890");
  assert.deepEqual([...requests[0]!.url.searchParams.entries()].sort(), [
    ["expansions", "author_id"],
    ["tweet.fields", "created_at,author_id"],
    ["user.fields", "id,name,username"],
  ].sort());
}

{
  const { client, requests } = clientWith(response(200, {
    data: Array.from({ length: 12 }, (_, index) => ({ ...post, id: String(index + 1) })),
    includes: { users: [author] },
  }));
  const posts = await client.searchRecentXPosts("synthetic-access-token", "  from:synthetic_user  ");
  assert.equal(posts.length, 10);
  assert.equal(requests[0]!.url.pathname, "/2/tweets/search/recent");
  assert.equal(requests[0]!.url.searchParams.get("query"), "from:synthetic_user");
  assert.equal(requests[0]!.url.searchParams.get("max_results"), "10");
  assert.equal(requests[0]!.url.searchParams.has("next_token"), false);
}

{
  const { client, requests } = clientWith(response(201, { data: { id: "1234567890", text: " exact text " } }));
  assert.deepEqual(await client.createXPost("synthetic-access-token", " exact text "), {
    id: "1234567890",
    text: " exact text ",
  });
  assert.equal(requests.length, 1, "create is dispatched exactly once");
  assert.equal(requests[0]!.url.href, "https://api.x.com/2/tweets");
  assert.equal(requests[0]!.init.body, JSON.stringify({ text: " exact text " }));
}

for (const [status, code] of [[401, "unauthorized"], [402, "billing-unavailable"], [403, "capability-disabled"], [404, "not-found"]] as const) {
  const { client } = clientWith(response(status, { detail: "sensitive upstream detail" }));
  await assert.rejects(
    () => client.fetchXAccount("synthetic-access-token"),
    (error: unknown) => assertXError(error, code),
    `maps ${status} without exposing the upstream body`,
  );
}

{
  const { client } = clientWith(response(429, {}, { "x-rate-limit-reset": "1785157200" }));
  await assert.rejects(
    () => client.fetchXAccount("synthetic-access-token"),
    (error: unknown) => error instanceof XApiError
      && error.code === "rate-limited"
      && error.retryAt === "2026-07-27T13:00:00.000Z",
  );
}

{
  const { client } = clientWith(response(400, { detail: "never surface this" }));
  await assert.rejects(() => client.fetchXAccount("synthetic-access-token"), (error: unknown) => assertXError(error, "invalid-request"));
}

for (const bad of [response(500, {})]) {
  const { client } = clientWith(bad);
  await assert.rejects(() => client.fetchXAccount("synthetic-access-token"), (error: unknown) => assertXError(error, "upstream-unavailable"));
}

{
  const { client } = clientWith(new Response("not json", { status: 200 }));
  await assert.rejects(() => client.fetchXAccount("synthetic-access-token"), (error: unknown) => assertXError(error, "invalid-response"));
}

{
  const encoder = new TextEncoder();
  const validButOversized = `${JSON.stringify({ data: author })}${" ".repeat(MAX_X_JSON_BYTES)}`;
  const chunks = Array.from({ length: Math.ceil(validButOversized.length / 1024) }, (_, index) =>
    encoder.encode(validButOversized.slice(index * 1024, (index + 1) * 1024)),
  );
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
  const { client } = clientWith(new Response(body, {
    status: 200,
    headers: { "content-type": "application/json" },
  }));
  await assert.rejects(
    () => client.fetchXAccount("synthetic-access-token"),
    (error: unknown) => assertXError(error, "invalid-response"),
    "an oversized chunked JSON body is rejected before it can be parsed",
  );
}

for (const bad of [
  response(200, { data: post }),
  response(200, { data: { ...post, unexpected: true }, includes: { users: [author] } }),
]) {
  const { client } = clientWith(bad);
  await assert.rejects(() => client.lookupXPost("synthetic-access-token", "1234567890"), (error: unknown) => assertXError(error, "invalid-response"));
}

for (const failure of [new Error("network down"), Object.assign(new Error("aborted"), { name: "AbortError" })]) {
  const { client } = clientWith(failure);
  await assert.rejects(() => client.fetchXAccount("synthetic-access-token"), (error: unknown) => assertXError(error, "upstream-unavailable"));
}

for (const failure of [
  new Error("write connection lost"),
  Object.assign(new Error("write aborted"), { name: "AbortError" }),
]) {
  const { client, requests } = clientWith(failure);
  await assert.rejects(
    () => client.createXPost("synthetic-access-token", "synthetic text"),
    (error: unknown) => assertXError(error, "ambiguous-write", true),
  );
  assert.equal(requests.length, 1, "a failed create is never retried");
}

{
  const stalled = stalledBodyClient();
  const pending = stalled.client.fetchXAccount("synthetic-access-token");
  await Promise.resolve();
  await Promise.resolve();
  stalled.triggerTimeout();
  await assert.rejects(pending, (error: unknown) => assertXError(error, "upstream-unavailable"));
}

{
  const stalled = stalledBodyClient();
  const pending = stalled.client.createXPost("synthetic-access-token", "synthetic text");
  await Promise.resolve();
  await Promise.resolve();
  stalled.triggerTimeout();
  await assert.rejects(pending, (error: unknown) => assertXError(error, "ambiguous-write", true));
  assert.equal(stalled.fetches(), 1, "a post-body stall must not trigger a second create request");
}

for (const invalidQuery of ["   ", "x".repeat(513), "🦇".repeat(513)]) {
  const { client, requests } = clientWith();
  await assert.rejects(() => client.searchRecentXPosts("synthetic-access-token", invalidQuery), (error: unknown) => assertXError(error, "invalid-request"));
  assert.equal(requests.length, 0, "invalid input never invokes fetch");
}

console.log("x-client.test.ts: ok");
