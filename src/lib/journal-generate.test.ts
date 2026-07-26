// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildReflectionPrompt, generateReflection } from "./journal-generate.ts";

{
  const p = buildReflectionPrompt("2026-06-20: 2 responses.\n- Reply to Sage");
  assert.match(p, /first-person/i, "asks for a first-person reflection");
  assert.match(p, /2026-06-20: 2 responses/, "embeds the provided context");
  assert.match(p, /Reply to Sage/, "embeds the item titles");
}

// ── The prompt is the rendered Generation-prompt template (cave-hlic) ────────
// The journal UI shows an editable template with {familiar}/{date}/{context}
// placeholders; what the user reads there is exactly what gets sent.
{
  const p = buildReflectionPrompt("ctx lines", {
    template: "Speak as {familiar} about {date}.\n{context}",
    familiar: "Sage",
    date: "June 20, 2026",
  });
  assert.equal(p, "Speak as Sage about June 20, 2026.\nctx lines", "a custom template renders verbatim");
}
{
  const p = buildReflectionPrompt("the day's activity", { template: "No context placeholder here." });
  assert.match(p, /the day's activity/, "context is still appended when a custom template drops {context}");
}
{
  const p = buildReflectionPrompt("c", { template: null });
  assert.match(p, /first-person/i, "a null template falls back to the default");
}

// ── next-paths stripped from generated reflections (cave-onp8) ───────────────
// /api/chat/send appends the next-paths directive to every prompt and a
// compliant familiar echoes the block back; the journal has no chip row, so
// generateReflection must strip it (terminated or truncated) before returning.
{
  const source = await readFile(new URL("./journal-generate.ts", import.meta.url), "utf8");
  assert.match(
    source,
    /import \{ extractNextPaths \} from "@\/lib\/next-paths";/,
    "uses the canonical (streaming-safe) next-paths extractor",
  );
  assert.match(
    source,
    /const trimmed = extractNextPaths\(text\)\.visible\.trim\(\);/,
    "the directive block is stripped from the reflection text",
  );
}

// ── id-framed SSE events must not read as an empty reply (cave-am2b) ─────────
// /api/chat/send frames every event as "id: N\ndata: {json}" (resume cursor).
// The old frame parser required frames to START with "data:", so every chunk
// was dropped and generation always failed with "didn't return a reflection".
{
  const originalFetch = globalThis.fetch;
  const encoder = new TextEncoder();
  try {
    globalThis.fetch = async () => new Response(
      new ReadableStream({
        start(controller) {
          const frames = [
            { kind: "session", sessionId: "j1" },
            { kind: "assistant_chunk", text: "A quiet, steady day" },
            { kind: "assistant_chunk", text: " of tending memory." },
            { kind: "done", sessionId: "j1", isError: false },
          ];
          frames.forEach((f, i) => controller.enqueue(encoder.encode(`id: ${i + 1}\ndata: ${JSON.stringify(f)}\n\n`)));
          controller.close();
        },
      }),
      { status: 200 },
    );
    const result = await generateReflection({ familiarId: "nova", context: "ctx" });
    assert.equal(result.error, null, "an id-framed stream is not an error");
    assert.equal(result.text, "A quiet, steady day of tending memory.", "chunks accumulate across id-framed frames");
  } finally {
    globalThis.fetch = originalFetch;
  }
}

// ── Replacement frames supersede earlier draft text ─────────────────────────
// Native-chat adapters can replace the running response after emitting chunks.
// Journal generation must preserve that stream contract while handling drops.
{
  const originalFetch = globalThis.fetch;
  const encoder = new TextEncoder();
  try {
    globalThis.fetch = async () => new Response(
      new ReadableStream({
        start(controller) {
          const frames = [
            { kind: "assistant_chunk", text: "Draft reflection." },
            { kind: "assistant_replace", text: "Final reflection." },
            { kind: "done", sessionId: "j2", isError: false },
          ];
          frames.forEach((frame, index) => {
            controller.enqueue(encoder.encode(`id: ${index + 1}\ndata: ${JSON.stringify(frame)}\n\n`));
          });
          controller.close();
        },
      }),
      { status: 200 },
    );
    const result = await generateReflection({ familiarId: "nova", context: "ctx" });
    assert.equal(result.error, null, "a replacement frame is not an error");
    assert.equal(result.text, "Final reflection.", "replacement text supersedes earlier chunks");
  } finally {
    globalThis.fetch = originalFetch;
  }
}

// ── Mid-stream failures become normal results instead of wedging the UI ──────
// ReadableStream reader.read() rejects when the connection drops after headers.
// The journal used to let that rejection escape, leaving JournalEntries'
// `generating` state stuck forever. Preserve any partial text and surface the
// transport failure just like the working Canvas generation path.
{
  const originalFetch = globalThis.fetch;
  const encoder = new TextEncoder();
  let pulls = 0;
  try {
    globalThis.fetch = async () => new Response(
      new ReadableStream({
        pull(controller) {
          pulls += 1;
          if (pulls === 1) {
            controller.enqueue(
              encoder.encode('id: 1\ndata: {"kind":"assistant_chunk","text":"A partial reflection."}\n\n'),
            );
            return;
          }
          controller.error(new Error("connection dropped"));
        },
      }),
      { status: 200 },
    );
    const result = await generateReflection({ familiarId: "nova", context: "ctx" });
    assert.equal(result.text, "A partial reflection.", "partial text survives a stream failure");
    assert.match(result.error ?? "", /connection dropped/, "the stream rejection is returned as an actionable error");
  } finally {
    globalThis.fetch = originalFetch;
  }
}

// A semantic SSE error is more actionable than the transport failure that can
// follow it while the server closes the stream. Preserve the first error.
{
  const originalFetch = globalThis.fetch;
  const encoder = new TextEncoder();
  let pulls = 0;
  try {
    globalThis.fetch = async () => new Response(
      new ReadableStream({
        pull(controller) {
          pulls += 1;
          if (pulls === 1) {
            controller.enqueue(
              encoder.encode('id: 1\ndata: {"kind":"error","message":"Familiar runtime is unavailable."}\n\n'),
            );
            return;
          }
          controller.error(new Error("socket reset"));
        },
      }),
      { status: 200 },
    );
    const result = await generateReflection({ familiarId: "nova", context: "ctx" });
    assert.equal(result.error, "Familiar runtime is unavailable.", "a later reader rejection does not replace the SSE error");
  } finally {
    globalThis.fetch = originalFetch;
  }
}

console.log("journal-generate.test.ts: ok");
