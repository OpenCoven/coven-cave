import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";

import type {
  NormalizedXArticle,
  XArticleFailureCode,
} from "../x-articles.ts";
import {
  MAX_X_ARTICLE_BODY_CHARS,
  MAX_X_ARTICLE_EXCERPT_CHARS,
  XArticleProviderError,
} from "../x-articles.ts";
import type { XArticleProvider } from "./x-article-provider.ts";
import {
  configuredXArticleProvider,
  configuredXArticleProviderWithDependencies,
} from "./x-article-provider.ts";
import { fetchSorsaXArticle } from "./x-article-sorsa.ts";

type Equal<Actual, Expected> =
  (<Value>() => Value extends Actual ? 1 : 2) extends
  (<Value>() => Value extends Expected ? 1 : 2)
    ? (<Value>() => Value extends Expected ? 1 : 2) extends
      (<Value>() => Value extends Actual ? 1 : 2)
      ? true
      : false
    : false;
type Assert<Condition extends true> = Condition;

export type XArticleProviderIsExact = Assert<Equal<XArticleProvider, {
  id: "sorsa";
  fetchArticle(url: string): Promise<NormalizedXArticle>;
}>>;

const ARTICLE_URL = "https://x.com/OpenCoven/status/123456789?ref=timeline";
const API_KEY = "super-secret-sorsa-key";
const RAW_DIAGNOSTIC = "never surface this raw upstream diagnostic";

function response(status: number, body: BodyInit | unknown, headers?: HeadersInit): Response {
  if (
    typeof body === "string"
    || body instanceof ReadableStream
    || body instanceof Blob
    || body instanceof ArrayBuffer
    || ArrayBuffer.isView(body)
    || body instanceof FormData
    || body instanceof URLSearchParams
  ) {
    return new Response(body as BodyInit, { status, headers });
  }
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function sorsaPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    full_text: "  First line title\nSecond paragraph.  ",
    preview_text: `Lead preview ${"🧙".repeat(MAX_X_ARTICLE_EXCERPT_CHARS + 5)}`,
    cover_image_url: "https://cdn.sorsa.io/articles/cover.png?size=full",
    published_at: "2026-08-17T12:34:56-05:00",
    author: {
      id: "42",
      username: "opencoven",
      display_name: "Open Coven",
    },
    ...overrides,
  };
}

function env(values: Partial<NodeJS.ProcessEnv>): NodeJS.ProcessEnv {
  return values as NodeJS.ProcessEnv;
}

function jsonBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

function chunkBytes(value: Uint8Array, chunkSize: number): Uint8Array[] {
  const chunks: Uint8Array[] = [];
  for (let index = 0; index < value.byteLength; index += chunkSize) {
    chunks.push(value.slice(index, index + chunkSize));
  }
  return chunks;
}

async function expectProviderError(
  run: () => Promise<unknown>,
  code: XArticleFailureCode,
  retryable: boolean,
): Promise<XArticleProviderError> {
  try {
    await run();
    assert.fail(`expected ${code}`);
  } catch (error) {
    assert.ok(error instanceof XArticleProviderError);
    assert.equal(error.code, code);
    assert.equal(error.retryable, retryable);
    const rendered = String(error);
    assert.equal(rendered.includes(API_KEY), false, "error strings must not leak the API key");
    assert.equal(
      rendered.includes(RAW_DIAGNOSTIC),
      false,
      "error strings must not leak raw upstream diagnostics",
    );
    return error;
  }
}

test("normalizes a Sorsa article and keeps the API key out of results", async () => {
  const requests: Array<{ url: URL; init: RequestInit }> = [];
  const article = await fetchSorsaXArticle(ARTICLE_URL, {
    apiKey: API_KEY,
    now: () => new Date("2026-08-18T18:00:00-05:00"),
    fetchImpl: async (input, init) => {
      requests.push({ url: new URL(String(input)), init: init ?? {} });
      return response(200, sorsaPayload());
    },
  });

  assert.equal(requests.length, 1);
  assert.equal(requests[0]!.url.href, "https://api.sorsa.io/v3/article");
  assert.equal(requests[0]!.init.method, "POST");
  assert.deepEqual(JSON.parse(String(requests[0]!.init.body)), {
    tweet_link: "https://x.com/opencoven/status/123456789",
  });
  const headers = new Headers(requests[0]!.init.headers);
  assert.equal(headers.get("ApiKey"), API_KEY);
  assert.equal(headers.get("content-type"), "application/json");
  assert.deepEqual([...headers.keys()].sort(), ["apikey", "content-type"]);

  const expectedBody = "First line title\nSecond paragraph.";
  assert.deepEqual(article, {
    provider: "sorsa",
    sourcePostId: "123456789",
    title: "First line title",
    titleSource: "derived",
    author: {
      id: "42",
      username: "opencoven",
      displayName: "Open Coven",
    },
    body: expectedBody,
    excerpt: Array.from(`Lead preview ${"🧙".repeat(MAX_X_ARTICLE_EXCERPT_CHARS + 5)}`)
      .slice(0, MAX_X_ARTICLE_EXCERPT_CHARS)
      .join(""),
    coverImageUrl: "https://cdn.sorsa.io/articles/cover.png?size=full",
    publishedAt: "2026-08-17T17:34:56.000Z",
    fetchedAt: "2026-08-18T23:00:00.000Z",
    contentSha256: createHash("sha256").update(expectedBody).digest("hex"),
  });
  assert.match(article.contentSha256, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(article).includes(API_KEY), false);
});

test("rejects non-X article URLs before issuing a provider request", async () => {
  let called = false;
  await expectProviderError(
    () => fetchSorsaXArticle("https://example.com/not-an-x-article", {
      apiKey: API_KEY,
      fetchImpl: async () => {
        called = true;
        return response(200, sorsaPayload());
      },
    }),
    "not-article",
    false,
  );
  assert.equal(called, false);
});

test("maps non-2xx responses without surfacing provider diagnostics", async () => {
  const cases = [
    { status: 401, code: "unauthorized", retryable: false },
    { status: 403, code: "unauthorized", retryable: false },
    { status: 404, code: "not-article", retryable: false },
    { status: 429, code: "rate-limited", retryable: true },
    { status: 500, code: "upstream-unavailable", retryable: true },
  ] as const;

  for (const entry of cases) {
    let cancelCalls = 0;
    let getReaderCalls = 0;
    await expectProviderError(
      () => fetchSorsaXArticle(ARTICLE_URL, {
        apiKey: API_KEY,
        fetchImpl: async () => ({
          ok: false,
          status: entry.status,
          headers: new Headers({ "content-type": "text/plain" }),
          body: {
            async cancel() {
              cancelCalls += 1;
              throw new Error(`${RAW_DIAGNOSTIC} ${API_KEY}`);
            },
            getReader() {
              getReaderCalls += 1;
              throw new Error("non-success response bodies must not be read");
            },
          },
        } as unknown as Response),
      }),
      entry.code,
      entry.retryable,
    );
    assert.equal(cancelCalls, 1);
    assert.equal(getReaderCalls, 0);
  }
});

test("maps malformed success payloads to invalid-response", async () => {
  const cases = [
    {
      name: "malformed json",
      payload: response(200, `${RAW_DIAGNOSTIC} ${API_KEY}`, { "content-type": "application/json" }),
    },
    {
      name: "non-object json",
      payload: response(200, [RAW_DIAGNOSTIC]),
    },
    {
      name: "missing required field",
      payload: response(200, (() => {
        const payload = sorsaPayload();
        delete payload.preview_text;
        return payload;
      })()),
    },
    {
      name: "invalid display_name type",
      payload: response(200, sorsaPayload({
        author: { id: "42", username: "opencoven", display_name: 9 },
      })),
    },
    {
      name: "whitespace-only author id",
      payload: response(200, sorsaPayload({
        author: { id: " \t", username: "opencoven" },
      })),
    },
    {
      name: "oversized author id",
      payload: response(200, sorsaPayload({
        author: { id: "a".repeat(129), username: "opencoven" },
      })),
    },
    {
      name: "empty display_name",
      payload: response(200, sorsaPayload({
        author: { id: "42", username: "opencoven", display_name: "" },
      })),
    },
    {
      name: "oversized display_name",
      payload: response(200, sorsaPayload({
        author: { id: "42", username: "opencoven", display_name: "a".repeat(201) },
      })),
    },
    {
      name: "invalid username",
      payload: response(200, sorsaPayload({
        author: { id: "42", username: "not-valid!", display_name: "Open Coven" },
      })),
    },
    {
      name: "invalid timestamp",
      payload: response(200, sorsaPayload({ published_at: "not-a-date" })),
    },
    {
      name: "invalid cover url credentials",
      payload: response(200, sorsaPayload({
        cover_image_url: "https://user:pass@example.com/private.png",
      })),
    },
    {
      name: "invalid cover url scheme",
      payload: response(200, sorsaPayload({
        cover_image_url: "ftp://example.com/private.png",
      })),
    },
    {
      name: "empty cover url",
      payload: response(200, sorsaPayload({ cover_image_url: "" })),
    },
    {
      name: "oversized cover url",
      payload: response(200, sorsaPayload({
        cover_image_url: `https://example.com/${"a".repeat(2_049)}`,
      })),
    },
  ] as const;

  for (const entry of cases) {
    await assert.doesNotReject(async () => {
      await expectProviderError(
        () => fetchSorsaXArticle(ARTICLE_URL, {
          apiKey: API_KEY,
          fetchImpl: async () => entry.payload,
        }),
        "invalid-response",
        true,
      );
    }, entry.name);
  }
});

test("rejects overlength numeric source post IDs before issuing a provider request", async () => {
  const oversizedPostIdUrl = `https://x.com/OpenCoven/status/${"1".repeat(33)}`;
  let fetchCalls = 0;
  const error = await expectProviderError(
    () => fetchSorsaXArticle(oversizedPostIdUrl, {
      apiKey: API_KEY,
      fetchImpl: async () => {
        fetchCalls += 1;
        return response(200, sorsaPayload());
      },
    }),
    "not-article",
    false,
  );
  assert.equal(fetchCalls, 0);
  assert.equal(error.message, "X article could not be resolved");
  assert.equal(String(error).includes("1".repeat(33)), false);
});

test("treats an empty body as not-article", async () => {
  await expectProviderError(
    () => fetchSorsaXArticle(ARTICLE_URL, {
      apiKey: API_KEY,
      fetchImpl: async () => response(200, sorsaPayload({ full_text: " \n\t " })),
    }),
    "not-article",
    false,
  );
});

test("rejects oversized article bodies by Unicode code points", async () => {
  await expectProviderError(
    () => fetchSorsaXArticle(ARTICLE_URL, {
      apiKey: API_KEY,
      fetchImpl: async () => response(200, sorsaPayload({
        full_text: "🧙".repeat(MAX_X_ARTICLE_BODY_CHARS + 1),
      })),
    }),
    "too-large",
    false,
  );
});

test("rejects oversized content-length responses before reading the body", async () => {
  let cancelCalls = 0;
  let getReaderCalls = 0;
  let textCalls = 0;
  let arrayBufferCalls = 0;

  await expectProviderError(
    () => fetchSorsaXArticle(ARTICLE_URL, {
      apiKey: API_KEY,
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        headers: new Headers({ "content-length": "5000000" }),
        body: {
          async cancel() {
            cancelCalls += 1;
            throw new Error(`${RAW_DIAGNOSTIC} ${API_KEY}`);
          },
          getReader() {
            getReaderCalls += 1;
            throw new Error("body reader should not be requested for oversized content-length");
          },
        },
        text: async () => {
          textCalls += 1;
          throw new Error("response.text should not be called for oversized content-length");
        },
        arrayBuffer: async () => {
          arrayBufferCalls += 1;
          throw new Error("response.arrayBuffer should not be called for oversized content-length");
        },
      } as unknown as Response),
    }),
    "too-large",
    false,
  );

  assert.equal(cancelCalls, 1);
  assert.equal(getReaderCalls, 0);
  assert.equal(textCalls, 0);
  assert.equal(arrayBufferCalls, 0);
});

test("cancels oversized chunked streams without reading the entire provider body", async () => {
  const payload = jsonBytes(sorsaPayload({
    preview_text: "x".repeat(2_000_000),
  }));
  const chunks = chunkBytes(payload, 64_000);
  let readCalls = 0;
  let cancelCalls = 0;
  let getReaderCalls = 0;
  let textCalls = 0;
  let arrayBufferCalls = 0;

  await expectProviderError(
    () => fetchSorsaXArticle(ARTICLE_URL, {
      apiKey: API_KEY,
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        headers: new Headers(),
        body: {
          getReader() {
            getReaderCalls += 1;
            let index = 0;
            return {
              closed: Promise.resolve(undefined),
              async read() {
                readCalls += 1;
                if (index >= chunks.length) return { done: true, value: undefined };
                const value = chunks[index]!;
                index += 1;
                return { done: false, value };
              },
              async cancel() {
                cancelCalls += 1;
              },
              releaseLock() {},
            } satisfies ReadableStreamDefaultReader<Uint8Array>;
          },
        },
        text: async () => {
          textCalls += 1;
          throw new Error("response.text should not be called when a stream body is available");
        },
        arrayBuffer: async () => {
          arrayBufferCalls += 1;
          throw new Error("response.arrayBuffer should not be called when a stream body is available");
        },
      } as unknown as Response),
    }),
    "too-large",
    false,
  );

  assert.equal(getReaderCalls, 1);
  assert.equal(cancelCalls, 1);
  assert.equal(readCalls < chunks.length, true);
  assert.equal(textCalls, 0);
  assert.equal(arrayBufferCalls, 0);
});

test("rejects body-less success responses without using unbounded buffer fallbacks", async () => {
  let textCalls = 0;
  let arrayBufferCalls = 0;

  await expectProviderError(
    () => fetchSorsaXArticle(ARTICLE_URL, {
      apiKey: API_KEY,
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        headers: new Headers(),
        body: null,
        text: async () => {
          textCalls += 1;
          throw new Error("response.text should not be called without a readable body stream");
        },
        arrayBuffer: async () => {
          arrayBufferCalls += 1;
          throw new Error("response.arrayBuffer should not be called without a readable body stream");
        },
      } as unknown as Response),
    }),
    "invalid-response",
    true,
  );

  assert.equal(textCalls, 0);
  assert.equal(arrayBufferCalls, 0);
});

test("maps timeouts and aborts to timeout", async () => {
  await expectProviderError(
    () => fetchSorsaXArticle(ARTICLE_URL, {
      apiKey: API_KEY,
      timeoutMs: 1,
      fetchImpl: async (_input, init) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(Object.assign(new Error(`${RAW_DIAGNOSTIC} ${API_KEY}`), { name: "AbortError" }));
        }, { once: true });
      }),
    }),
    "timeout",
    true,
  );
});

test("maps network failures to upstream-unavailable", async () => {
  await expectProviderError(
    () => fetchSorsaXArticle(ARTICLE_URL, {
      apiKey: API_KEY,
      fetchImpl: async () => {
        throw new Error(`${RAW_DIAGNOSTIC} ${API_KEY}`);
      },
    }),
    "upstream-unavailable",
    true,
  );
});

test("accepts canonical UTC published_at timestamps", async () => {
  const article = await fetchSorsaXArticle(ARTICLE_URL, {
    apiKey: API_KEY,
    now: () => new Date("2026-08-18T18:00:00-05:00"),
    fetchImpl: async () => response(200, sorsaPayload({
      published_at: "2026-08-17T20:00:00.000Z",
    })),
  });

  assert.equal(article.publishedAt, "2026-08-17T20:00:00.000Z");
});

test("rejects non-timezone-qualified or impossible published_at timestamps", async () => {
  const invalidPublishedAtValues = [
    "2026-02-30T00:00:00Z",
    "2026-08-17",
    "1692302400000",
    "2026-08-17T20:00:00",
    "2026-08-17T24:00:00Z",
    "2026-08-17T20:60:00Z",
    "2026-08-17T20:00:00+24:00",
    "2026-08-17T20:00:00.000Z trailing",
  ] as const;

  for (const publishedAt of invalidPublishedAtValues) {
    await assert.doesNotReject(async () => {
      await expectProviderError(
        () => fetchSorsaXArticle(ARTICLE_URL, {
          apiKey: API_KEY,
          fetchImpl: async () => response(200, sorsaPayload({ published_at: publishedAt })),
        }),
        "invalid-response",
        true,
      );
    }, publishedAt);
  }
});

test("selects the configured provider and resolves the Sorsa API key server-side", async () => {
  const expectedArticle = {
    provider: "sorsa",
    sourcePostId: "123456789",
    title: "First line title",
    titleSource: "derived",
    author: { id: "42", username: "opencoven" },
    body: "First line title\nSecond paragraph.",
    excerpt: "Lead preview",
    publishedAt: "2026-08-17T17:34:56.000Z",
    fetchedAt: "2026-08-18T23:00:00.000Z",
    contentSha256: createHash("sha256").update("First line title\nSecond paragraph.").digest("hex"),
  } satisfies NormalizedXArticle;
  const calls: Array<{ url: string; apiKey: string }> = [];
  const resolved = configuredXArticleProviderWithDependencies(
    env({ COVEN_CAVE_X_ARTICLE_PROVIDER: "  SORSA  " }),
    {
      resolveSecretImpl: (key) => {
        assert.equal(key, "SORSA_API_KEY");
        return API_KEY;
      },
      fetchSorsaXArticleImpl: async (url, options) => {
        calls.push({ url, apiKey: options.apiKey });
        return expectedArticle;
      },
    },
  );

  assert.equal(resolved.id, "sorsa");
  assert.deepEqual(await resolved.fetchArticle(ARTICLE_URL), expectedArticle);
  assert.deepEqual(calls, [{ url: ARTICLE_URL, apiKey: API_KEY }]);

  await expectProviderError(
    async () => configuredXArticleProvider(env({})),
    "not-configured",
    false,
  );
  await expectProviderError(
    async () => configuredXArticleProviderWithDependencies(
      env({ COVEN_CAVE_X_ARTICLE_PROVIDER: "unsupported" }),
      { resolveSecretImpl: () => API_KEY },
    ),
    "not-configured",
    false,
  );
  await expectProviderError(
    async () => configuredXArticleProviderWithDependencies(
      env({ COVEN_CAVE_X_ARTICLE_PROVIDER: "sorsa" }),
      { resolveSecretImpl: () => undefined },
    ),
    "missing-credential",
    false,
  );
  await expectProviderError(
    async () => configuredXArticleProviderWithDependencies(
      env({ COVEN_CAVE_X_ARTICLE_PROVIDER: "sorsa" }),
      {
        resolveSecretImpl: () => {
          throw new Error(`${RAW_DIAGNOSTIC} ${API_KEY}`);
        },
      },
    ),
    "missing-credential",
    false,
  );
});
