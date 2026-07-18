// @ts-nocheck
import assert from "node:assert/strict";

import { generateArtifactCode, parseSseFrame } from "./canvas-generate.ts";

// parseSseFrame is the pure half of the streaming generator — it must tolerate
// the exact frame shape /api/chat/send emits ("data: {json}") and shrug off
// anything malformed without throwing.

assert.deepEqual(
  parseSseFrame('data: {"kind":"assistant_chunk","text":"hi"}'),
  { kind: "assistant_chunk", text: "hi" },
  "a well-formed data frame parses to its event",
);

assert.deepEqual(
  parseSseFrame('data:{"kind":"done","sessionId":"s1"}'),
  { kind: "done", sessionId: "s1" },
  "no space after the colon is fine",
);

assert.equal(parseSseFrame(": keep-alive comment"), null, "SSE comments are ignored");
assert.equal(parseSseFrame("event: ping"), null, "non-data lines are ignored");
assert.equal(parseSseFrame("data: "), null, "empty data payload yields null");
assert.equal(parseSseFrame("data: {not json"), null, "malformed JSON yields null, not a throw");

const originalFetch = globalThis.fetch;
const encoder = new TextEncoder();
const responseFor = (frames) => new Response(
  new ReadableStream({
    start(controller) {
      for (const frame of frames) controller.enqueue(encoder.encode(`data: ${JSON.stringify(frame)}\n\n`));
      controller.close();
    },
  }),
  { status: 200 },
);

try {
  let sentBody = null;
  globalThis.fetch = async (_url, init) => {
    sentBody = JSON.parse(init.body);
    return responseFor([
      { kind: "session", sessionId: "canvas-session" },
      { kind: "assistant_chunk", text: "```html\n<!doctype html><html></html>\n```" },
      { kind: "done", sessionId: "canvas-session" },
    ]);
  };
  const valid = await generateArtifactCode({ familiarId: "nova", prompt: "build" });
  assert.equal(valid.failure, null);
  assert.equal(valid.kind, "html");
  assert.equal(valid.sessionId, "canvas-session");
  assert.equal(sentBody.origin, "canvas");

  globalThis.fetch = async (_url, init) => {
    sentBody = JSON.parse(init.body);
    return responseFor([
      { kind: "assistant_chunk", text: "Here is some prose without a complete preview." },
      { kind: "done" },
    ]);
  };
  const malformed = await generateArtifactCode({
    familiarId: "nova",
    prompt: "repair",
    sessionId: "canvas-session",
  });
  assert.equal(malformed.failure, "format", "successful stream + no artifact is a structured format failure");
  assert.equal(malformed.sessionId, "canvas-session", "repair keeps the original hidden session when no new session event arrives");
  assert.equal(sentBody.sessionId, "canvas-session", "repair resumes the original Canvas-origin run");

  globalThis.fetch = async () => new Response("offline", { status: 503 });
  const transport = await generateArtifactCode({ familiarId: "nova", prompt: "build" });
  assert.equal(transport.failure, "transport", "HTTP/runtime failures are never classified as repairable format failures");
} finally {
  globalThis.fetch = originalFetch;
}

console.log("canvas-generate.test.ts ✓");
