import assert from "node:assert/strict";
import {
  clearHermesModelCache,
  listHermesModelInventory,
  listHermesModels,
} from "./hermes-models.ts";

let apiKey = "secret-token";
const scopedEnv = () => ({
  HERMES_API_URL: "https://hermes.example/v1",
  HERMES_API_KEY: apiKey,
});

clearHermesModelCache();
let requestedUrl = "";
let authorization = "";
let redirectMode: RequestRedirect | undefined;
let successfulFetches = 0;
const successfulFetch = (async (input, init) => {
  successfulFetches += 1;
  requestedUrl = String(input);
  authorization = new Headers(init?.headers).get("authorization") ?? "";
  redirectMode = init?.redirect;
  return new Response(JSON.stringify({
    data: [
      { id: "openrouter/auto" },
      { id: "openrouter/auto" },
      { id: "hermes-local" },
      { id: "--unsafe" },
      { id: "contains space" },
      null,
    ],
  }));
}) as typeof fetch;
const models = await listHermesModels("sage", {
  scopedEnv,
  fetchImpl: successfulFetch,
});
assert.equal(requestedUrl, "https://hermes.example/v1/models");
assert.equal(authorization, "Bearer secret-token");
assert.equal(redirectMode, "error", "provider discovery never follows redirects");
assert.deepEqual(models, [
  { id: "openrouter/auto", label: "openrouter/auto" },
]);
assert.equal(
  (await listHermesModelInventory("sage", {
    scopedEnv,
    fetchImpl: successfulFetch,
  })).provenance,
  "cached",
  "successful discovery is cached within the validated familiar and provider scope",
);
apiKey = "rotated-token";
assert.equal(
  (await listHermesModelInventory("sage", {
    scopedEnv,
    fetchImpl: successfulFetch,
  })).provenance,
  "live",
  "a credential change invalidates the provider inventory fingerprint",
);
assert.equal(successfulFetches, 2);
apiKey = "secret-token";

clearHermesModelCache();
let unconfiguredFetches = 0;
assert.deepEqual(
  await listHermesModels("sage", {
    scopedEnv: () => ({ HERMES_API_URL: "https://hermes.example/v1" }),
    fetchImpl: (async () => {
      unconfiguredFetches += 1;
      return new Response();
    }) as typeof fetch,
  }),
  [],
);
assert.equal(unconfiguredFetches, 0, "an incomplete API configuration never reaches fetch");

clearHermesModelCache();
let invalidEndpointFetches = 0;
assert.deepEqual(
  await listHermesModels("sage", {
    scopedEnv: () => ({
      HERMES_API_URL: "http://provider.example/v1",
      HERMES_API_KEY: "secret-token",
    }),
    fetchImpl: (async () => {
      invalidEndpointFetches += 1;
      return new Response();
    }) as typeof fetch,
  }),
  [],
);
assert.equal(invalidEndpointFetches, 0, "plaintext non-loopback endpoints are rejected");

clearHermesModelCache();
let failureFetches = 0;
let failureStreamCancelled = false;
assert.deepEqual(
  await listHermesModels("sage", {
    scopedEnv,
    fetchImpl: (async () => {
      failureFetches += 1;
      return new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("no"));
        },
        cancel() {
          failureStreamCancelled = true;
        },
      }), { status: 503 });
    }) as typeof fetch,
  }),
  [],
  "provider failures fail soft without fabricating models",
);
assert.equal(failureStreamCancelled, true, "failed response bodies are cancelled");
await listHermesModels("sage", {
  scopedEnv,
  fetchImpl: (async () => {
    failureFetches += 1;
    return new Response(JSON.stringify({ data: [{ id: "openrouter/recovered" }] }));
  }) as typeof fetch,
});
assert.equal(failureFetches, 2, "failed or empty discovery is never cached");

clearHermesModelCache();
let declaredStreamCancelled = false;
assert.deepEqual(
  await listHermesModels("sage", {
    scopedEnv,
    maxBytes: 4,
    fetchImpl: (async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("{}"));
      },
      cancel() {
        declaredStreamCancelled = true;
      },
    }), {
      headers: { "content-length": "5" },
    })) as typeof fetch,
  }),
  [],
  "a declared oversized model payload is not buffered",
);
assert.equal(declaredStreamCancelled, true, "declared oversized response bodies are cancelled");

let streamCancelled = false;
const streamedTooLarge = new ReadableStream<Uint8Array>({
  start(controller) {
    controller.enqueue(new Uint8Array([1, 2, 3]));
    controller.enqueue(new Uint8Array([4, 5, 6]));
  },
  cancel() {
    streamCancelled = true;
  },
});
assert.deepEqual(
  await listHermesModels("sage", {
    scopedEnv,
    maxBytes: 4,
    fetchImpl: (async () => new Response(streamedTooLarge)) as typeof fetch,
  }),
  [],
  "a streamed oversized model payload is aborted",
);
assert.equal(streamCancelled, true);

clearHermesModelCache();
let concurrentFetches = 0;
const pendingResponses: Array<(response: Response) => void> = [];
const boundedDependencies = {
  scopedEnv,
  maxConcurrentDiscoveries: 4,
  fetchImpl: (async () => {
    concurrentFetches += 1;
    return await new Promise<Response>((resolve) => pendingResponses.push(resolve));
  }) as typeof fetch,
};
const boundedRequests = Array.from(
  { length: 5 },
  (_, index) => listHermesModelInventory(`bounded-${index}`, boundedDependencies),
);
assert.equal(concurrentFetches, 4, "discovery fan-out is globally bounded");
assert.deepEqual(
  await boundedRequests[4],
  { models: [], provenance: "live" },
  "a distinct scope above the discovery limit fails soft",
);
for (const resolve of pendingResponses) {
  resolve(new Response(JSON.stringify({ data: [{ id: "openrouter/auto" }] })));
}
await Promise.all(boundedRequests.slice(0, 4));

clearHermesModelCache();
assert.deepEqual(
  await listHermesModels("sage", {
    scopedEnv,
    timeoutMs: 1,
    fetchImpl: ((_, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), {
        once: true,
      });
    })) as typeof fetch,
  }),
  [],
  "a hung model endpoint is bounded by the resolver timeout",
);

console.log("server/hermes-models.test.ts: ok");
