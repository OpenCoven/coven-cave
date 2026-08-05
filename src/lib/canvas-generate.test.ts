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

// /api/chat/send frames every event as "id: N\ndata: {json}" so the stream can
// be resumed — a parser requiring the frame to START with "data:" dropped every
// event and the journal/canvas saw an empty reply (cave-am2b).
assert.deepEqual(
  parseSseFrame('id: 7\ndata: {"kind":"assistant_chunk","text":"hi"}'),
  { kind: "assistant_chunk", text: "hi" },
  "an id line ahead of the data payload is tolerated",
);

assert.deepEqual(
  parseSseFrame('id: 7\r\ndata: {"kind":"done","sessionId":"s1"}'),
  { kind: "done", sessionId: "s1" },
  "CRLF line endings inside a frame are tolerated",
);

assert.deepEqual(
  parseSseFrame('event: message\nid: 2\ndata: {"kind":"session","sessionId":"s2"}'),
  { kind: "session", sessionId: "s2" },
  "event: and id: lines are skipped, data still parses",
);

assert.equal(parseSseFrame("id: 9"), null, "a frame with no data line yields null");

const originalFetch = globalThis.fetch;
const encoder = new TextEncoder();
// Mirror the real wire shape: /api/chat/send prefixes every frame with an
// "id: N" line (resume cursor). The generator must parse these, not just
// bare "data:" frames (cave-am2b).
const responseFor = (frames) => new Response(
  new ReadableStream({
    start(controller) {
      frames.forEach((frame, i) => controller.enqueue(encoder.encode(`id: ${i + 1}\ndata: ${JSON.stringify(frame)}\n\n`)));
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

  const streamed = [];
  globalThis.fetch = async () => responseFor([
    { kind: "assistant_chunk", text: "Preview incoming " },
    { kind: "assistant_chunk", text: "<coven:att" },
    { kind: "assistant_chunk", text: 'ention reason="approval" />```html\n<!doctype html><html></html>\n```' },
    { kind: "done", sessionId: "canvas-session" },
  ]);
  const markerStripped = await generateArtifactCode({
    familiarId: "nova",
    prompt: "build",
    onText: (text) => streamed.push(text),
  });
  assert.deepEqual(
    streamed,
    [
      "Preview incoming ",
      "Preview incoming ",
      "Preview incoming ```html\n<!doctype html><html></html>\n```",
    ],
    "Canvas streaming hides partial attention marker tails and never flashes the completed marker",
  );
  assert.equal(
    markerStripped.text,
    "Preview incoming ```html\n<!doctype html><html></html>\n```",
    "the final Canvas contract strips the raw marker before returning text",
  );
  assert.equal(markerStripped.code, "<!doctype html><html></html>");

  globalThis.fetch = async () => responseFor([
    { kind: "assistant_chunk", text: '```\n<coven:attention reason="approval" />\n```' },
    { kind: "done", sessionId: "canvas-session" },
  ]);
  const fenced = await generateArtifactCode({ familiarId: "nova", prompt: "build" });
  assert.equal(
    fenced.text,
    '```\n<coven:attention reason="approval" />\n```',
    "fenced literal attention examples remain visible in Canvas text output",
  );

  globalThis.fetch = async () => responseFor([
    { kind: "assistant_chunk", text: "Bad marker " },
    { kind: "assistant_chunk", text: '<coven:attention reason="approval">' },
    { kind: "done", sessionId: "canvas-session" },
  ]);
  const malformedMarker = await generateArtifactCode({ familiarId: "nova", prompt: "build" });
  assert.equal(
    malformedMarker.text,
    "Bad marker ",
    "malformed non-chat attention tags are stripped from the returned Canvas transcript",
  );
} finally {
  globalThis.fetch = originalFetch;
}

console.log("canvas-generate.test.ts ✓");
