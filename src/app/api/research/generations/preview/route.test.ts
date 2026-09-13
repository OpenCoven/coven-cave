import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { after, beforeEach, test } from "node:test";

import type { ResearchMediaReadiness, ResearchMediaRenderConfig } from "../../../../../lib/research-generations.ts";
import { validateResearchMediaSelection } from "../../../../../lib/server/research-media-readiness.ts";
import { withPodcastAbort } from "../../../../../lib/server/research-podcast-pipeline.ts";

const state = {
  calls: [] as ResearchMediaRenderConfig[],
  readiness: {} as ResearchMediaReadiness,
  validateResearchMediaSelection,
  withPodcastAbort,
  synthesize: async (_config: ResearchMediaRenderConfig, _signal: AbortSignal): Promise<Uint8Array> => new Uint8Array([82, 73, 70, 70]),
};
const globalState = globalThis as typeof globalThis & { __podcastPreviewTest?: typeof state };
globalState.__podcastPreviewTest = state;
const mocks: Record<string, string> = {
  "@/lib/server/research-media-readiness": `
    const state = globalThis.__podcastPreviewTest;
    export const getResearchMediaReadiness = async () => state.readiness;
    export const validateResearchMediaSelection = state.validateResearchMediaSelection;
  `,
  "@/lib/server/research-podcast-pipeline": `
    const state = globalThis.__podcastPreviewTest;
    export const PODCAST_PREVIEW_TIMEOUT_MS = 200;
    export const withPodcastAbort = state.withPodcastAbort;
    export const synthesizeResearchPodcastPreview = async (config, signal) => {
      state.calls.push(config);
      return state.synthesize(config, signal);
    };
  `,
};
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (mocks[specifier]) {
      return { url: `data:text/javascript,${encodeURIComponent(mocks[specifier])}`, shortCircuit: true };
    }
    if (specifier === "next/server") return nextResolve("next/server.js", context);
    if (specifier.startsWith("@/")) {
      return nextResolve(new URL(`../../../../../${specifier.slice(2)}.ts`, import.meta.url).href, context);
    }
    return nextResolve(specifier, context);
  },
});
const { POST } = await import("./route.ts");
const previousToken = process.env.COVEN_CAVE_AUTH_TOKEN;

beforeEach(() => {
  delete process.env.COVEN_CAVE_AUTH_TOKEN;
  state.calls = [];
  state.readiness = {
    providers: {
      local: { ready: true, voices: [{ id: "piper-amy", name: "Amy", engine: "piper" }] },
      elevenlabs: { ready: true, defaultVoiceId: "21m00Tcm4TlvDq8ikWAM" },
    },
    ffmpeg: { ready: false }, podcast: { ready: true },
    shortVideo: { ready: false }, longVideo: { ready: false },
  };
  state.synthesize = async () => new Uint8Array([82, 73, 70, 70]);
});

after(() => {
  hooks.deregister();
  delete globalState.__podcastPreviewTest;
  if (previousToken === undefined) delete process.env.COVEN_CAVE_AUTH_TOKEN;
  else process.env.COVEN_CAVE_AUTH_TOKEN = previousToken;
});

function request(body: unknown = { provider: "local", voice: "piper-amy" }, init: RequestInit = {}) {
  return new Request("http://localhost/api/research/generations/preview", {
    method: "POST",
    ...init,
    headers: { host: "localhost", "content-type": "application/json", ...Object.fromEntries(new Headers(init.headers)) },
    body: JSON.stringify(body),
  });
}

test("preview preserves the local and packaged sidecar authorization gate", async () => {
  for (const headers of [
    { host: "untrusted.example" },
    { origin: "https://untrusted.example" },
    { "x-coven-cave-mobile-access": "1" },
  ] as Record<string, string>[]) {
    assert.equal((await POST(request(undefined, { headers }))).status, 403);
  }
  process.env.COVEN_CAVE_AUTH_TOKEN = "private-test-token";
  assert.equal((await POST(request())).status, 403);
  assert.equal(state.calls.length, 0);
  assert.equal((await POST(request(undefined, { headers: { "x-coven-cave-token": "private-test-token" } }))).status, 200);
});

test("preview returns private no-store WAV with exact selected configuration", async () => {
  const config = {
    provider: "elevenlabs", voice: "AZnzlk1XvdvUeBnXmlld",
    model: "eleven_multilingual_v2", seed: 77,
    voiceSettings: { stability: 0.3, similarityBoost: 0.75, style: 0, speed: 1.1, useSpeakerBoost: false },
  };
  const response = await POST(request(config));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "audio/wav");
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(state.calls, [{ ...config, length: "brief" }]);
  assert.equal(new TextDecoder().decode(await response.arrayBuffer()), "RIFF");
});

test("preview rejects arbitrary text, oversized bodies, invalid settings and unavailable selections", async () => {
  for (const body of [
    { provider: "local", voice: "piper-amy", text: "private research" },
    { provider: "other", voice: "piper-amy" },
    { provider: "elevenlabs", voice: "AZnzlk1XvdvUeBnXmlld", model: "eleven_v3", voiceSettings: { stability: 0.35 } },
    { provider: "elevenlabs", voice: "AZnzlk1XvdvUeBnXmlld", seed: -1 },
  ]) {
    const response = await POST(request(body));
    assert.equal(response.status, 400);
    assert.equal((await response.json()).ok, false);
  }
  assert.equal((await POST(request({ provider: "local", voice: "missing" }))).status, 409);
  assert.equal((await POST(request({ provider: "elevenlabs", voice: "../bad" }))).status, 409);
  assert.equal((await POST(request({ text: "a".repeat(4_097) }))).status, 413);
  assert.equal((await POST(request({}, { headers: { "content-type": "text/plain" } }))).status, 415);
  state.readiness.providers.elevenlabs.ready = false;
  assert.equal((await POST(request({ provider: "elevenlabs", voice: "AZnzlk1XvdvUeBnXmlld" }))).status, 409);
  assert.equal(state.calls.length, 0);
});

test("provider failures are sanitized JSON with no fallback, retry or persistence", async () => {
  state.synthesize = async () => { throw new Error("SECRET provider account detail"); };
  const response = await POST(request());
  assert.equal(response.status, 502);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  const body = await response.json();
  assert.equal(body.ok, false);
  assert.doesNotMatch(body.error, /SECRET/);
  assert.equal(state.calls.length, 1);
  const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /writeResearchGenerationMedia|createResearchGeneration|startResearchMediaJobs|enqueueResearch/);
});

test("request cancellation aborts the selected provider and releases its preview slot", async () => {
  const controller = new AbortController();
  let started!: () => void;
  const ready = new Promise<void>((resolve) => { started = resolve; });
  let providerSignal!: AbortSignal;
  state.synthesize = async (_config, signal) => {
    providerSignal = signal;
    started();
    return new Promise(() => {});
  };
  const response = POST(request(undefined, { signal: controller.signal }));
  await ready;
  controller.abort();
  assert.equal((await response).status, 499);
  assert.equal(providerSignal.aborted, true);
  state.synthesize = async () => new Uint8Array([1]);
  assert.equal((await POST(request())).status, 200);
});

test("preview enforces its timeout and limits concurrent provider requests", async () => {
  let started!: () => void;
  const ready = new Promise<void>((resolve) => { started = resolve; });
  state.synthesize = async () => {
    if (state.calls.length === 2) started();
    return new Promise(() => {});
  };
  const first = POST(request());
  const second = POST(request());
  await ready;
  assert.equal((await POST(request())).status, 429);
  // AbortSignal.timeout is unref'ed; keep the test alive while observing it.
  const hold = setTimeout(() => {}, 500);
  try {
    assert.deepEqual((await Promise.all([first, second])).map((response) => response.status), [504, 504]);
    assert.equal(state.calls.length, 2);
  } finally {
    clearTimeout(hold);
  }
});

test("a cancelled stalled request body is closed without starting synthesis", async () => {
  const controller = new AbortController();
  let cancelled = false;
  const req = new Request("http://localhost/api/research/generations/preview", {
    method: "POST",
    headers: { host: "localhost", "content-type": "application/json" },
    signal: controller.signal,
    body: new ReadableStream({ cancel() { cancelled = true; } }),
    duplex: "half",
  } as RequestInit);
  const response = POST(req);
  controller.abort();
  assert.equal((await response).status, 499);
  assert.equal(cancelled, true);
  assert.equal(state.calls.length, 0);
});
