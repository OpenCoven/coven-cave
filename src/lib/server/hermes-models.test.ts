import assert from "node:assert/strict";
import {
  clearHermesModelCache,
  listHermesModelInventory,
  listHermesModels,
} from "./hermes-models.ts";
import { listRuntimeModelInventory } from "./runtime-model-options.ts";
import { runtimeModelIdForLaunch } from "../runtime-models.ts";

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

// Hermes /v1/models exposes a route alias as id and its configured model as
// root. The alias must remain the launch value, but cannot hide an old release.
clearHermesModelCache();
const aliased = await listHermesModelInventory("aliased", {
  scopedEnv,
  fetchImpl: (async () => new Response(JSON.stringify({ data: [
    { id: "hermes-agent", root: "hermes-agent" },
    { id: "old-fast", root: "openai/gpt-5.6-sol", parent: "hermes-agent" },
    { id: "current-fast", root: "openai/gpt-6.1-sol", parent: "hermes-agent" },
    { id: "gpt-99-sol", root: "openai/gpt-5.6-sol", parent: "hermes-agent" },
    { id: "sonnet", root: "anthropic/claude-sonnet-5", parent: "hermes-agent" },
    { id: "custom", root: "private/custom-deployment", parent: "hermes-agent" },
    { id: "bad-root", root: "unsafe\nmodel", parent: "hermes-agent" },
    { id: "object-root", root: { model: "openai/gpt-6.1-sol" } },
  ] }))) as typeof fetch,
});
const aliasedMenu = await listRuntimeModelInventory("hermes", "aliased", {
  allowHermesInventory: true,
  listHermesInventory: async () => aliased,
});
assert.deepEqual(aliasedMenu.models.map(({ id }) => id), [
  "hermes-agent", "current-fast", "sonnet", "custom", "bad-root", "object-root",
], "known backing models drive the family policy, not arbitrary alias spelling");
assert.deepEqual(aliasedMenu.models.find(({ id }) => id === "current-fast"), {
  id: "current-fast", label: "current-fast (configured: openai/gpt-6.1-sol)",
  configuredModelId: "openai/gpt-6.1-sol",
});
assert.deepEqual(aliasedMenu.models.find(({ id }) => id === "hermes-agent"), {
  id: "hermes-agent", label: "hermes-agent",
}, "the default model name does not fabricate a backing model");
assert.deepEqual(aliasedMenu.models.find(({ id }) => id === "bad-root"), {
  id: "bad-root", label: "bad-root",
}, "malformed root metadata is not displayed or used for filtering");
assert.equal(runtimeModelIdForLaunch("hermes", aliasedMenu.models[1]!.id), "current-fast",
  "launch uses the discovered alias rather than replacing it with a configured model");

console.log("server/hermes-models.test.ts: ok");
