import assert from "node:assert/strict";
import test from "node:test";
import { gzipSync } from "node:zlib";

import {
  fetchResearchResource,
  isPublicResearchAddress,
  parseResearchFetchUrl,
  resolvePublicResearchAddresses,
  type ResearchFetchConnection,
  type ResearchFetchConnectionResponse,
} from "./research-resource-fetch.ts";

function response(input: {
  status?: number;
  headers?: Record<string, string>;
  chunks?: Array<string | Uint8Array>;
  rawHeaderBytes?: number;
} = {}): ResearchFetchConnectionResponse {
  let destroyed = false;
  const body = (async function* () {
    for (const chunk of input.chunks ?? ["ok"]) {
      if (destroyed) return;
      yield typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    }
  })();
  return {
    status: input.status ?? 200,
    headers: input.headers ?? { "content-type": "text/plain" },
    rawHeaderBytes: input.rawHeaderBytes ?? 64,
    body,
    destroy() {
      destroyed = true;
    },
  };
}

const publicAddress = [{ address: "93.184.216.34", family: 4 as const }];

test("public-address classification denies special, private, documentation, and metadata ranges", () => {
  for (const address of [
    "0.0.0.0", "10.0.0.1", "100.100.100.200", "127.0.0.1",
    "169.254.169.254", "172.31.0.1", "192.0.2.1", "192.168.1.1",
    "198.19.0.1", "198.51.100.2", "203.0.113.5", "224.0.0.1",
    "239.255.255.255", "240.0.0.1", "255.255.255.254", "255.255.255.255",
    "::", "::1", "fc00::1", "fe80::1", "2001:db8::1", "ff02::1",
    "::ffff:127.0.0.1", "localhost", "",
  ]) assert.equal(isPublicResearchAddress(address), false, address);
  for (const address of ["1.1.1.1", "8.8.8.8", "93.184.216.34", "2606:4700:4700::1111"]) {
    assert.equal(isPublicResearchAddress(address), true, address);
  }
});

test("URL parsing permits only credential-free HTTP(S) on default ports", () => {
  assert.equal(parseResearchFetchUrl("https://example.com/path")?.hostname, "example.com");
  assert.equal(parseResearchFetchUrl("http://example.com:80/path")?.port, "");
  assert.equal(parseResearchFetchUrl("https://example.com:443/path")?.port, "");
  for (const raw of [
    "file:///etc/passwd", "ftp://example.com/a", "https://user@example.com/a",
    "https://user:secret@example.com/a", "http://example.com:8080/a", "not a URL",
  ]) assert.equal(parseResearchFetchUrl(raw), null, raw);
});

test("the production resolver rejects a hostname containing any private answer", async () => {
  await assert.rejects(() => resolvePublicResearchAddresses("localhost"), /not public/);
});

test("manual redirects resolve every hop and pin the validated address set into the connection", async () => {
  const resolved: string[] = [];
  const connected: Array<{ host: string; address: string; headers: string[] }> = [];
  const connect: ResearchFetchConnection = async ({ url, addresses, headers }) => {
    connected.push({ host: url.hostname, address: addresses[0].address, headers: Object.keys(headers).sort() });
    if (url.hostname === "one.example") {
      return response({ status: 302, headers: { location: "https://two.example/final" } });
    }
    return response({
      headers: { "content-type": "text/plain", etag: '"v1"' },
      chunks: ["public bytes"],
    });
  };
  const result = await fetchResearchResource("https://one.example/start", {
    resolve: async (host) => {
      resolved.push(host);
      return [{ address: host === "one.example" ? "93.184.216.34" : "1.1.1.1", family: 4 }];
    },
    connect,
    now: () => new Date("2026-08-27T22:00:00.000Z"),
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.finalUrl, "https://two.example/final");
    assert.equal(Buffer.from(result.bytes).toString("utf8"), "public bytes");
    assert.equal(result.etag, '"v1"');
  }
  assert.deepEqual(resolved, ["one.example", "two.example"]);
  assert.deepEqual(connected.map(({ host, address }) => ({ host, address })), [
    { host: "one.example", address: "93.184.216.34" },
    { host: "two.example", address: "1.1.1.1" },
  ]);
  assert.deepEqual(connected[0].headers, ["accept", "accept-encoding", "user-agent"]);
});

test("a rebinding/private answer on a redirect is rejected before the second connection", async () => {
  let connections = 0;
  const result = await fetchResearchResource("https://public.example/start", {
    resolve: async (host) => host === "public.example"
      ? publicAddress : [{ address: "127.0.0.1", family: 4 }],
    connect: async () => {
      connections += 1;
      return response({ status: 302, headers: { location: "https://rebound.example/private" } });
    },
  });
  assert.deepEqual(result, { ok: false, disposition: "nonretryable", code: "unsafe_destination" });
  assert.equal(connections, 1);
});

test("redirect count, missing locations, and unsafe redirect ports fail closed", async () => {
  const alwaysRedirect: ResearchFetchConnection = async ({ url }) => response({
    status: 302,
    headers: { location: `https://${url.hostname}/again` },
  });
  assert.deepEqual(
    await fetchResearchResource("https://example.com", {
      resolve: async () => publicAddress,
      connect: alwaysRedirect,
      limits: { maxRedirects: 1 },
    }),
    { ok: false, disposition: "nonretryable", code: "too_many_redirects" },
  );
  for (const location of [undefined, "http://example.com:8000/private"]) {
    const result = await fetchResearchResource("https://example.com", {
      resolve: async () => publicAddress,
      connect: async () => response({
        status: 302,
        headers: location ? { location } : {},
      }),
    });
    assert.deepEqual(result, { ok: false, disposition: "nonretryable", code: "invalid_redirect" });
  }
});

test("header, declared body, and streamed body limits abort before returning bytes", async () => {
  const cases: Array<[ResearchFetchConnectionResponse, string]> = [
    [response({ rawHeaderBytes: 101 }), "headers_too_large"],
    [response({ headers: { "content-type": "text/plain", "content-length": "101" } }), "body_too_large"],
    [response({ chunks: ["123456", "789012"] }), "body_too_large"],
  ];
  for (const [fixture, code] of cases) {
    const result = await fetchResearchResource("https://example.com", {
      resolve: async () => publicAddress,
      connect: async () => fixture,
      limits: { maxHeaderBytes: 100, maxTextBodyBytes: 10 },
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, code);
  }
});

test("quota, server, client, encoding, and timeout results have truthful dispositions", async () => {
  const now = new Date("2026-08-27T22:00:00.000Z");
  const fixtures: Array<[ResearchFetchConnection, Partial<{ disposition: string; code: string; retryAfterMs: number }>]> = [
    [async () => response({ status: 429, headers: { "retry-after": "60" } }),
      { disposition: "paused_quota", code: "quota_pause", retryAfterMs: 60_000 }],
    [async () => response({ status: 503 }), { disposition: "retryable", code: "http_server" }],
    [async () => response({ status: 404 }), { disposition: "nonretryable", code: "http_client" }],
    [async () => response({ headers: { "content-encoding": "gzip" } }),
      { disposition: "nonretryable", code: "http_client" }],
  ];
  for (const [connect, expected] of fixtures) {
    const result = await fetchResearchResource("https://example.com", {
      resolve: async () => publicAddress,
      connect,
      now: () => now,
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.disposition, expected.disposition);
      assert.equal(result.code, expected.code);
      if (expected.retryAfterMs) assert.equal(result.retryAfterMs, expected.retryAfterMs);
    }
  }

  const timeout = await fetchResearchResource("https://example.com", {
    resolve: async () => publicAddress,
    connect: ({ signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
    }),
    limits: { totalTimeoutMs: 5 },
  });
  assert.deepEqual(timeout, { ok: false, disposition: "retryable", code: "timed_out" });
});

test("invalid or misleading content lengths and unexpected compression are never read", async () => {
  for (const headers of [
    { "content-type": "text/plain", "content-length": "nope" },
    { "content-type": "text/plain", "content-length": "-1" },
  ]) {
    const result = await fetchResearchResource("https://example.com", {
      resolve: async () => publicAddress,
      connect: async () => response({ headers }),
    });
    assert.deepEqual(result, { ok: false, disposition: "nonretryable", code: "body_too_large" });
  }
});

test("compressed and decompressed bytes are bounded independently", async () => {
  const compressed = gzipSync(Buffer.from("compressible public text"));
  const success = await fetchResearchResource("https://example.com", {
    resolve: async () => publicAddress,
    connect: async () => response({
      headers: { "content-type": "text/plain", "content-encoding": "gzip" },
      chunks: [compressed],
    }),
  });
  assert.equal(success.ok, true);
  if (success.ok) assert.equal(Buffer.from(success.bytes).toString("utf8"), "compressible public text");

  const expansion = await fetchResearchResource("https://example.com", {
    resolve: async () => publicAddress,
    connect: async () => response({
      headers: { "content-type": "text/plain", "content-encoding": "gzip" },
      chunks: [gzipSync(Buffer.from("x".repeat(100)))],
    }),
    limits: { maxTextBodyBytes: 50 },
  });
  assert.deepEqual(expansion, { ok: false, disposition: "nonretryable", code: "body_too_large" });
});
