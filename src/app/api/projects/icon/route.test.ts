/**
 * Behavioural guards for POST /api/projects/icon.
 *
 * This drives the real handler with a stubbed `fetch`, so it asserts what the
 * route DOES: what it asks the provider for, what it refuses, what it returns.
 * It replaces a source-text version that regex-matched route.ts and never
 * called POST — that suite passed against any implementation whose source
 * happened to contain the right identifiers, including one that returned the
 * provider's bytes unvalidated under the provider's own declared mime.
 *
 * No network: `fetch` is stubbed for every test, and the two tests that must
 * never reach the provider assert the stub was not called. This endpoint bills
 * a paid image API, so "no request was made" is itself a guarded property.
 *
 * The vault is pointed at a nonexistent temp root before the route is loaded,
 * so key resolution depends only on what each test puts in `process.env` and
 * never on the developer's real `.env.local` or vault.
 */

import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const secretRoot = mkdtempSync(path.join(tmpdir(), "coven-icon-route-"));
process.env.COVEN_VAULT_FILE = path.join(secretRoot, "vault.yaml");
process.env.COVEN_CAVE_ENV_FILE = path.join(secretRoot, ".env.local");
process.env.COVEN_CAVE_LOCAL_VAULT_FILE = path.join(secretRoot, "local-vault.enc.json");
process.env.COVEN_CAVE_LOCAL_VAULT_KEY_FILE = path.join(secretRoot, "local-vault.key");

const sharp = (await import("sharp")).default;
const { POST } = await import("./route.ts");
const { projectTint } = await import("@/lib/comux-projects");
const { projectIconRateLimiter } = await import("@/lib/server/project-icon-rate-limit");

const ROOT = "/Users/dev/coven-cave";
const OPENAI_KEY = "sk-test-openai-key";
const GOOGLE_KEY = "test-google-key";

// ── fixtures ────────────────────────────────────────────────────────────────

/** A real, decodable PNG — the provider's "good" answer. */
const PNG = await sharp({
  create: { width: 512, height: 512, channels: 3, background: { r: 180, g: 40, b: 90 } },
}).png().toBuffer();

/** Active content dressed as an image. Must never survive to the response. */
const SVG = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
  "utf8",
);

const GIF = Buffer.concat([
  Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]),
  Buffer.alloc(64, 0x21),
]);

type Upstream = { url: string; headers: Headers; body: Record<string, unknown> };

/** Stub `fetch`, recording every upstream call. Restored by each test. */
function stubFetch(reply: (call: Upstream) => Response | Promise<Response> | never) {
  const calls: Upstream[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: Upstream = {
      url: String(input),
      headers: new Headers(init?.headers),
      body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
    };
    calls.push(call);
    return reply(call);
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = real; } };
}

function openaiReply(image: Buffer): Response {
  return Response.json({ data: [{ b64_json: image.toString("base64") }] });
}

/** Imagen's shape — including the declared `mimeType` the route must ignore. */
function geminiReply(image: Buffer, mimeType: string): Response {
  return Response.json({
    predictions: [{ bytesBase64Encoded: image.toString("base64"), mimeType }],
  });
}

function request(body: unknown, contentType = "application/json"): Request {
  return new Request("http://localhost:3000/api/projects/icon", {
    method: "POST",
    headers: {
      "Content-Type": contentType,
      Host: "localhost:3000",
      Origin: "http://localhost:3000",
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => projectIconRateLimiter.reset());

/** Run `fn` with exactly the given vault keys present in the environment. */
async function withKeys<T>(keys: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const saved: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(keys)) {
    saved[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

const withOpenAI = <T>(fn: () => Promise<T>) =>
  withKeys({ OPENAI_API_KEY: OPENAI_KEY, GOOGLE_API_KEY: undefined }, fn);

// ── guards that must not spend money ────────────────────────────────────────

test("a non-local request is refused before any provider call", async () => {
  const net = stubFetch(() => openaiReply(PNG));
  try {
    const req = new Request("https://example.com/api/projects/icon", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Host: "example.com",
        Origin: "https://example.com",
      },
      body: JSON.stringify({ name: "coven-cave", root: ROOT }),
    });
    const res = await withOpenAI(() => POST(req));
    assert.equal(res.status, 403);
    assert.equal(net.calls.length, 0, "a non-local request must not bill the provider");
  } finally {
    net.restore();
  }
});

test("a non-JSON request is refused before any provider call", async () => {
  const net = stubFetch(() => openaiReply(PNG));
  try {
    const res = await withOpenAI(() => POST(request("name=x", "text/plain")));
    assert.equal(res.status, 415);
    assert.equal(net.calls.length, 0, "a malformed request must not bill the provider");
  } finally {
    net.restore();
  }
});

test("a request without name and root is refused before any provider call", async () => {
  const net = stubFetch(() => openaiReply(PNG));
  try {
    for (const body of [{}, { name: "app" }, { root: ROOT }, { name: "  ", root: "  " }]) {
      const res = await withOpenAI(() => POST(request({ ...body, model: "openai/gpt-5.5" })));
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.equal((await res.json()).error, "missing_fields");
    }
    assert.equal(net.calls.length, 0, "incomplete input must not bill the provider");
  } finally {
    net.restore();
  }
});

test("with no image-capable vault key, nothing is requested and the key is named", async () => {
  const net = stubFetch(() => openaiReply(PNG));
  try {
    const res = await withKeys(
      { OPENAI_API_KEY: undefined, GOOGLE_API_KEY: undefined },
      () => POST(request({ name: "coven-cave", root: ROOT, model: "openai/gpt-5.5" })),
    );
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.ok, false);
    assert.equal(body.error, "vault_key_unresolved");
    assert.equal(body.missingKey, "OPENAI_API_KEY");
    assert.match(body.hint, /Vault/);
    assert.equal(net.calls.length, 0, "an unresolved key must not bill the provider");
  } finally {
    net.restore();
  }
});

test("a repeated generation is rate limited before a second provider call", async () => {
  const net = stubFetch(() => openaiReply(PNG));
  try {
    const first = await withOpenAI(() =>
      POST(request({ name: "coven-cave", root: ROOT, model: "openai/gpt-5.5" })),
    );
    assert.equal(first.status, 200);

    const repeated = await withOpenAI(() =>
      POST(request({ name: "coven-cave", root: ROOT, model: "openai/gpt-5.5" })),
    );
    assert.equal(repeated.status, 429);
    assert.equal(repeated.headers.get("retry-after"), "60");
    const body = await repeated.json();
    assert.equal(body.error, "rate_limited");
    assert.equal(body.retryAfterSeconds, 60);
    assert.equal(net.calls.length, 1, "the throttled request must not bill the provider");
  } finally {
    net.restore();
  }
});

// ── the happy path, and the hue agreement ───────────────────────────────────

test("generates an icon whose prompt hue is the hue projectTint paints", async () => {
  const net = stubFetch(() => openaiReply(PNG));
  try {
    const res = await withOpenAI(() =>
      POST(request({ name: "coven-cave", root: ROOT, variant: 3, model: "openai/gpt-5.5" })),
    );

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.provider, "openai");
    assert.equal(body.mime, "image/webp");
    assert.match(body.dataUrl, /^data:image\/webp;base64,[A-Za-z0-9+/]+={0,2}$/);

    // One upstream call, to OpenAI, carrying the vault key.
    assert.equal(net.calls.length, 1);
    assert.equal(net.calls[0].url, "https://api.openai.com/v1/images/generations");
    assert.equal(net.calls[0].headers.get("authorization"), `Bearer ${OPENAI_KEY}`);
    assert.equal(net.calls[0].body.model, "gpt-image-1");
    assert.equal(net.calls[0].body.output_format, "webp");
    assert.equal(net.calls[0].body.quality, "low");

    // The determinism agreement, asserted at the route boundary: the hue the
    // prompt asks the model for is the SAME hue ProjectAvatar's tile is
    // painted with. Read out of projectTint's actual output, not recomputed
    // from a hash — a second copy of the hash would agree with itself while
    // both drifted away from the colour the user sees.
    const tintHue = Number(/ (\d{1,3})\)$/.exec(projectTint(ROOT))?.[1]);
    assert.ok(Number.isFinite(tintHue), "projectTint should expose a hue");
    const promptHue = Number(/hue ~(\d+)deg/.exec(String(net.calls[0].body.prompt))?.[1]);
    assert.equal(promptHue, tintHue, "the icon prompt must ask for the tile's own hue");
  } finally {
    net.restore();
  }
});

test("the resolved API key never appears in the response", async () => {
  const net = stubFetch(() => openaiReply(PNG));
  try {
    const res = await withOpenAI(() =>
      POST(request({ name: "coven-cave", root: ROOT, model: "openai/gpt-5.5" })),
    );
    const raw = await res.text();
    assert.ok(!raw.includes(OPENAI_KEY), "the API key must not be echoed to the client");
  } finally {
    net.restore();
  }
});

// ── untrusted provider bytes ────────────────────────────────────────────────

test("an SVG from the provider is refused, not returned as an icon", async () => {
  const net = stubFetch(() => openaiReply(SVG));
  try {
    const res = await withOpenAI(() =>
      POST(request({ name: "coven-cave", root: ROOT, model: "openai/gpt-5.5" })),
    );
    assert.equal(res.status, 502);
    const body = await res.json();
    assert.equal(body.ok, false);
    assert.equal(body.error, "unsupported_image_format");
    assert.equal(body.dataUrl, undefined, "no data URL may escape a refused image");
  } finally {
    net.restore();
  }
});

test("a format outside the raster allowlist is refused", async () => {
  const net = stubFetch(() => openaiReply(GIF));
  try {
    const res = await withOpenAI(() =>
      POST(request({ name: "coven-cave", root: ROOT, model: "openai/gpt-5.5" })),
    );
    assert.equal(res.status, 502);
    assert.equal((await res.json()).error, "unsupported_image_format");
  } finally {
    net.restore();
  }
});

test("the provider's declared mimeType does not decide what is served", async () => {
  // Imagen declares its own content type. Here it lies in both directions:
  // real PNG bytes labelled image/svg+xml. The bytes win — the response is
  // canonical WebP, and the declared type reaches the client nowhere.
  const net = stubFetch(() => geminiReply(PNG, "image/svg+xml"));
  try {
    const res = await withKeys(
      { OPENAI_API_KEY: undefined, GOOGLE_API_KEY: GOOGLE_KEY },
      () => POST(request({ name: "coven-cave", root: ROOT, model: "google/gemini-3.1-pro" })),
    );

    assert.equal(res.status, 200);
    const raw = await res.text();
    assert.ok(!raw.includes("svg"), "a declared SVG type must not reach the client");

    const body = JSON.parse(raw);
    assert.equal(body.ok, true);
    assert.equal(body.provider, "gemini");
    assert.equal(body.mime, "image/webp");
    assert.match(body.dataUrl, /^data:image\/webp;base64,/);

    assert.equal(net.calls.length, 1);
    assert.match(net.calls[0].url, /^https:\/\/generativelanguage\.googleapis\.com\//);
    assert.equal(net.calls[0].headers.get("x-goog-api-key"), GOOGLE_KEY);
  } finally {
    net.restore();
  }
});

// ── provider failures ───────────────────────────────────────────────────────

test("an upstream error becomes a 502 carrying the provider's message", async () => {
  const net = stubFetch(() =>
    Response.json({ error: { message: "Billing hard limit reached" } }, { status: 429 }),
  );
  try {
    const res = await withOpenAI(() =>
      POST(request({ name: "coven-cave", root: ROOT, model: "openai/gpt-5.5" })),
    );
    assert.equal(res.status, 502);
    const body = await res.json();
    assert.equal(body.error, "provider_generation_failed");
    assert.equal(body.providerMessage, "Billing hard limit reached");
  } finally {
    net.restore();
  }
});

test("an unreachable provider becomes a 502, not an unhandled rejection", async () => {
  const net = stubFetch(() => {
    throw new TypeError("fetch failed");
  });
  try {
    const res = await withOpenAI(() =>
      POST(request({ name: "coven-cave", root: ROOT, model: "openai/gpt-5.5" })),
    );
    assert.equal(res.status, 502);
    assert.equal((await res.json()).error, "provider_unreachable");
  } finally {
    net.restore();
  }
});

test("an empty provider payload becomes a 502", async () => {
  const net = stubFetch(() => Response.json({ data: [] }));
  try {
    const res = await withOpenAI(() =>
      POST(request({ name: "coven-cave", root: ROOT, model: "openai/gpt-5.5" })),
    );
    assert.equal(res.status, 502);
    assert.equal((await res.json()).error, "provider_empty_image");
  } finally {
    net.restore();
  }
});

console.log("projects icon route.test.ts: ok");
