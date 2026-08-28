import assert from "node:assert/strict";
import test from "node:test";

import {
  configuredResearchEmbeddingProvider,
  embedResearchResourceInputs,
  MAX_RESEARCH_EMBEDDING_INPUT_BYTES,
  MAX_RESEARCH_EMBEDDING_INPUTS,
  MAX_RESEARCH_EMBEDDING_RESPONSE_BYTES,
  ResearchEmbeddingProviderError,
  researchEmbeddingModelRevision,
  validateResearchEmbeddingProviderConfig,
  type ResearchEmbeddingProviderConfig,
} from "./research-resource-embedding-provider.ts";

const openAi = (overrides: Partial<ResearchEmbeddingProviderConfig> = {}): ResearchEmbeddingProviderConfig => ({
  providerId: "local-openai",
  protocol: "openai",
  endpoint: "http://127.0.0.1:11434/v1/embeddings",
  modelId: "nomic-embed-text",
  dimensions: 3,
  ...overrides,
});

function jsonResponse(value: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

function expectProviderError(error: unknown, code: ResearchEmbeddingProviderError["code"]): boolean {
  assert.ok(error instanceof ResearchEmbeddingProviderError);
  assert.equal(error.code, code);
  assert.equal(error.cause, undefined);
  assert.equal(String(error.cause), "undefined");
  return true;
}

test("provider configuration accepts only explicit literal-loopback HTTP(S) endpoints", () => {
  assert.equal(validateResearchEmbeddingProviderConfig(openAi()).endpoint, "http://127.0.0.1:11434/v1/embeddings");
  assert.equal(validateResearchEmbeddingProviderConfig(openAi({ endpoint: "https://[::1]:8080/api/embed" })).endpoint,
    "https://[::1]:8080/api/embed");
  for (const endpoint of [
    "http://localhost:11434/v1/embeddings",
    "http://127.0.0.1.evil.test/v1/embeddings",
    "http://192.168.1.2/v1/embeddings",
    "http://user:secret@127.0.0.1/v1/embeddings",
    "file:///tmp/embed",
    "http://127.0.0.1/",
    "http://127.0.0.1/v1/embeddings?model=secret",
    "http://127.0.0.1/v1/embeddings#fragment",
  ]) {
    assert.throws(() => validateResearchEmbeddingProviderConfig(openAi({ endpoint })),
      (error) => expectProviderError(error, "invalid_configuration"), endpoint);
  }
});

test("model revision is deterministic and invalidates every compatibility input", () => {
  const baseline = researchEmbeddingModelRevision(openAi());
  assert.match(baseline, /^[a-f0-9]{64}$/);
  assert.equal(researchEmbeddingModelRevision(openAi()), baseline);
  for (const changed of [
    openAi({ providerId: "other-provider" }),
    openAi({ protocol: "ollama" }),
    openAi({ endpoint: "http://127.0.0.2:11434/v1/embeddings" }),
    openAi({ modelId: "other-model" }),
    openAi({ dimensions: 4 }),
  ]) assert.notEqual(researchEmbeddingModelRevision(changed), baseline);
});

test("environment configuration reports absent and malformed providers truthfully", () => {
  assert.deepEqual(configuredResearchEmbeddingProvider({}), { state: "unavailable", code: "not_configured" });
  assert.deepEqual(configuredResearchEmbeddingProvider({ CAVE_RESEARCH_EMBEDDING_PROVIDER_ID: "partial" }),
    { state: "unavailable", code: "invalid_configuration" });
  const ready = configuredResearchEmbeddingProvider({
    CAVE_RESEARCH_EMBEDDING_PROVIDER_ID: "ollama",
    CAVE_RESEARCH_EMBEDDING_PROTOCOL: "ollama",
    CAVE_RESEARCH_EMBEDDING_ENDPOINT: "http://127.0.0.1:11434/api/embed",
    CAVE_RESEARCH_EMBEDDING_MODEL_ID: "nomic-embed-text",
    CAVE_RESEARCH_EMBEDDING_DIMENSIONS: "768",
  });
  assert.equal(ready.state, "ready");
  if (ready.state === "ready") assert.equal(ready.dimensions, 768);
});

test("OpenAI-compatible requests are credential-free, no-redirect, bounded, and index-stable", async () => {
  let request: RequestInit | undefined;
  const vectors = await embedResearchResourceInputs(openAi(), ["alpha", "beta"], {
    fetch: async (_input, init) => {
      request = init;
      return jsonResponse({
        model: "nomic-embed-text",
        data: [
          { index: 1, embedding: [0, 1, 0] },
          { index: 0, embedding: [1, 0, 0] },
        ],
      });
    },
  });
  assert.deepEqual(vectors, [[1, 0, 0], [0, 1, 0]]);
  assert.equal(request?.redirect, "manual");
  assert.equal(request?.credentials, "omit");
  assert.deepEqual(JSON.parse(String(request?.body)), {
    model: "nomic-embed-text", input: ["alpha", "beta"], dimensions: 3,
  });
});

test("request input count and aggregate UTF-8 bytes are bounded before fetch", async () => {
  let calls = 0;
  const fetch = async () => { calls += 1; return jsonResponse({ data: [] }); };
  await assert.rejects(embedResearchResourceInputs(
    openAi(), Array.from({ length: MAX_RESEARCH_EMBEDDING_INPUTS + 1 }, () => "x"), { fetch },
  ), (error) => expectProviderError(error, "invalid_input"));
  await assert.rejects(embedResearchResourceInputs(
    openAi(), ["x".repeat(MAX_RESEARCH_EMBEDDING_INPUT_BYTES + 1)], { fetch },
  ), (error) => expectProviderError(error, "invalid_input"));
  assert.equal(calls, 0);
});

test("Ollama requests and responses use the native batch shape", async () => {
  let body: unknown;
  const vectors = await embedResearchResourceInputs(openAi({
    protocol: "ollama", endpoint: "http://[::1]:11434/api/embed",
    modelId: "nomic-embed-text:latest",
  }), ["alpha"], {
    fetch: async (_input, init) => {
      body = JSON.parse(String(init?.body));
      return jsonResponse({ model: "nomic-embed-text:latest", embeddings: [[0.1, 0.2, 0.3]] });
    },
  });
  assert.deepEqual(body, { model: "nomic-embed-text:latest", input: ["alpha"], truncate: false });
  assert.deepEqual(vectors, [[0.1, 0.2, 0.3]]);
});

test("response validation rejects wrong count, indexes, model, dimensions, and non-finite/zero vectors", async () => {
  const invalid = [
    { data: [] },
    { data: [{ index: 2, embedding: [1, 0, 0] }] },
    { model: "wrong", data: [{ index: 0, embedding: [1, 0, 0] }] },
    { data: [{ index: 0, embedding: [1, 0] }] },
    { data: [{ index: 0, embedding: [0, 0, 0] }] },
    { data: [{ index: 0, embedding: [1, null, 0] }] },
    { data: [{ index: 0, embedding: [1e100, 0, 0] }] },
    { data: [{ index: 0, embedding: [1e-100, 0, 0] }] },
  ];
  for (const value of invalid) {
    await assert.rejects(embedResearchResourceInputs(openAi(), ["alpha"], {
      fetch: async () => jsonResponse(value),
    }), (error) => expectProviderError(error, "invalid_response"));
  }
});

test("provider status, media type, declared length, stream size, and timeout fail with bounded codes", async () => {
  await assert.rejects(embedResearchResourceInputs(openAi(), ["alpha"], {
    fetch: async () => new Response(null, {
      status: 302, headers: { location: "http://127.0.0.1:9/redirected" },
    }),
  }), (error) => expectProviderError(error, "provider_rejected"));
  await assert.rejects(embedResearchResourceInputs(openAi(), ["alpha"], {
    fetch: async () => new Response("private provider body", { status: 503 }),
  }), (error) => expectProviderError(error, "provider_offline"));
  await assert.rejects(embedResearchResourceInputs(openAi(), ["alpha"], {
    fetch: async () => new Response("{}", { headers: { "content-type": "text/plain" } }),
  }), (error) => expectProviderError(error, "invalid_media_type"));
  await assert.rejects(embedResearchResourceInputs(openAi(), ["alpha"], {
    fetch: async () => new Response("{}", { headers: {
      "content-type": "application/json",
      "content-length": String(MAX_RESEARCH_EMBEDDING_RESPONSE_BYTES + 1),
    } }),
  }), (error) => expectProviderError(error, "response_too_large"));
  await assert.rejects(embedResearchResourceInputs(openAi(), ["alpha"], {
    fetch: async () => new Response(new ReadableStream<Uint8Array>({
      start(stream) {
        const block = new Uint8Array(1024 * 1024);
        for (let index = 0; index < 33; index += 1) stream.enqueue(block);
        stream.close();
      },
    }), { headers: { "content-type": "application/json" } }),
  }), (error) => expectProviderError(error, "response_too_large"));
  await assert.rejects(embedResearchResourceInputs(openAi(), ["alpha"], {
    timeoutMs: 1,
    fetch: async (_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("secret socket detail")));
    }),
  }), (error) => {
    assert.ok(error instanceof ResearchEmbeddingProviderError);
    assert.equal(error.code, "aborted");
    assert.equal(error.disposition, "unavailable");
    assert.doesNotMatch(error.message, /secret|socket|detail/);
    assert.equal(error.cause, undefined);
    assert.doesNotMatch(String(error.cause), /secret|socket|detail/);
    return true;
  });
});

test("an oversized response stays failed when cancellation races the deadline", async () => {
  await assert.rejects(embedResearchResourceInputs(openAi(), ["alpha"], {
    timeoutMs: 10,
    fetch: async (_input, init) => new Response(new ReadableStream<Uint8Array>({
      start(stream) {
        const block = new Uint8Array(1024 * 1024);
        for (let index = 0; index < 33; index += 1) stream.enqueue(block);
      },
      cancel() {
        return new Promise<void>((resolve) => {
          if (init?.signal?.aborted) resolve();
          else init?.signal?.addEventListener("abort", () => resolve(), { once: true });
        });
      },
    }), { headers: { "content-type": "application/json" } }),
  }), (error) => {
    assert.ok(error instanceof ResearchEmbeddingProviderError);
    assert.equal(error.code, "response_too_large");
    assert.equal(error.disposition, "failed");
    assert.equal(error.cause, undefined);
    assert.equal(String(error.cause), "undefined");
    return true;
  });
});

test("the request deadline remains active after headers and aborts a stalled response body", async () => {
  const startedAt = Date.now();
  await assert.rejects(embedResearchResourceInputs(openAi(), ["alpha"], {
    timeoutMs: 10,
    fetch: async (_input, init) => new Response(new ReadableStream<Uint8Array>({
      start(stream) {
        stream.enqueue(new TextEncoder().encode('{"data":['));
        init?.signal?.addEventListener("abort", () => {
          stream.error(new Error("private stalled body detail"));
        }, { once: true });
      },
    }), { headers: { "content-type": "application/json" } }),
  }), (error) => {
    assert.ok(error instanceof ResearchEmbeddingProviderError);
    assert.equal(error.code, "aborted");
    assert.equal(error.disposition, "unavailable");
    assert.doesNotMatch(error.message, /private|stalled|body detail/);
    assert.equal(error.cause, undefined);
    assert.doesNotMatch(String(error.cause), /private|stalled|body detail/);
    return true;
  });
  assert.ok(Date.now() - startedAt < 500, "the stalled body is bounded by the request deadline");
});

test("an early response stream failure is bounded and exposes no private diagnostics", async () => {
  await assert.rejects(embedResearchResourceInputs(openAi(), ["alpha"], {
    timeoutMs: 1_000,
    fetch: async () => new Response(new ReadableStream<Uint8Array>({
      start(stream) {
        stream.error(new Error("/private/provider/socket: secret upstream body failure"));
      },
    }), { headers: { "content-type": "application/json" } }),
  }), (error) => {
    assert.ok(error instanceof ResearchEmbeddingProviderError);
    assert.equal(error.code, "provider_offline");
    assert.equal(error.disposition, "unavailable");
    assert.equal(error.message, "embedding response body is unavailable");
    assert.doesNotMatch(error.message, /private|socket|secret|upstream|body failure/);
    assert.equal(error.cause, undefined);
    assert.doesNotMatch(String(error.cause), /private|socket|secret|upstream|body failure/);
    assert.doesNotMatch(JSON.stringify(error), /private|socket|secret|upstream|body failure/);
    return true;
  });
});
