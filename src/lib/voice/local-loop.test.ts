// @ts-nocheck
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  buildLocalBrainMessages,
  DEFAULT_LOCAL_LLM_BASE,
  DEFAULT_LOCAL_MODEL,
  localLlmBaseUrl,
  localVoiceProvider,
  probeLocalLlm,
} from "./local-loop.ts";

// ── Base URL resolution ──────────────────────────────────────────────────────

test("localLlmBaseUrl defaults to the Ollama loopback and honors overrides", () => {
  assert.equal(localLlmBaseUrl(undefined), DEFAULT_LOCAL_LLM_BASE);
  assert.equal(localLlmBaseUrl(""), DEFAULT_LOCAL_LLM_BASE);
  assert.equal(localLlmBaseUrl("  "), DEFAULT_LOCAL_LLM_BASE);
  assert.equal(localLlmBaseUrl("http://127.0.0.1:1234"), "http://127.0.0.1:1234");
  assert.equal(localLlmBaseUrl("http://127.0.0.1:1234//"), "http://127.0.0.1:1234");
});

// ── Brain message assembly ───────────────────────────────────────────────────

test("buildLocalBrainMessages leads with the persona and caps the turn tail", () => {
  const turns = Array.from({ length: 30 }, (_, i) => ({
    role: i % 2 === 0 ? "user" : "assistant",
    content: `turn ${i}`,
  }));
  const messages = buildLocalBrainMessages("You are Milo.", turns, 24);
  assert.equal(messages[0].role, "system");
  assert.equal(messages[0].content, "You are Milo.");
  assert.equal(messages.length, 25); // system + capped tail
  assert.equal(messages.at(-1).content, "turn 29"); // newest turns win
  assert.equal(messages[1].content, "turn 6"); // oldest six dropped
});

// ── Reachability probe ───────────────────────────────────────────────────────

test("probeLocalLlm reports ok on 200 and detail on failure", async () => {
  const ok = await probeLocalLlm("http://x", async () => new Response("{}", { status: 200 }));
  assert.deepEqual(ok, { ok: true });

  const bad = await probeLocalLlm("http://x", async () => new Response("nope", { status: 503 }));
  assert.equal(bad.ok, false);
  assert.match(bad.detail, /http 503/);

  const down = await probeLocalLlm("http://x", async () => { throw new Error("ECONNREFUSED"); });
  assert.equal(down.ok, false);
  assert.match(down.detail, /ECONNREFUSED/);
});

// ── mintSession ──────────────────────────────────────────────────────────────

const realFetch = globalThis.fetch;
let nextFetch: (() => Promise<Response>) | null = null;
let lastUrl: string | null = null;

globalThis.fetch = async (url, init) => {
  lastUrl = String(url);
  if (nextFetch) return nextFetch();
  return realFetch(url, init);
};

beforeEach(() => {
  nextFetch = null;
  lastUrl = null;
  delete process.env.COVEN_LOCAL_LLM_URL;
});

test("mintSession grants a keyless local-loop session carrying the persona", async () => {
  nextFetch = async () => new Response("{}", { status: 200 });
  const grant = await localVoiceProvider.mintSession("", {
    familiarId: "milo",
    model: "",
    voice: "Samantha",
    instructions: "You are Milo.",
    conversationSeed: [{ role: "user", content: "hi" }],
  });
  assert.equal(grant.provider, "local");
  assert.equal(grant.connection.kind, "local-loop");
  assert.equal(grant.connection.model, DEFAULT_LOCAL_MODEL); // empty model falls back
  assert.equal(grant.connection.voice, "Samantha");
  assert.equal(grant.connection.instructions, "You are Milo.");
  assert.deepEqual(grant.connection.conversationSeed, [{ role: "user", content: "hi" }]);
  assert.match(lastUrl, /\/v1\/models$/);
});

test("mintSession fails actionably when no loopback server answers", async () => {
  nextFetch = async () => { throw new Error("ECONNREFUSED"); };
  await assert.rejects(
    () => localVoiceProvider.mintSession("", {
      familiarId: "milo", model: "llama3.2", voice: "", instructions: "x",
    }),
    /local_llm_unreachable[\s\S]*Ollama[\s\S]*COVEN_LOCAL_LLM_URL/,
  );
});

test("mintSession probes the COVEN_LOCAL_LLM_URL override", async () => {
  process.env.COVEN_LOCAL_LLM_URL = "http://127.0.0.1:1234/";
  nextFetch = async () => new Response("{}", { status: 200 });
  await localVoiceProvider.mintSession("", {
    familiarId: "milo", model: "qwen3", voice: "", instructions: "x",
  });
  assert.equal(lastUrl, "http://127.0.0.1:1234/v1/models");
});
