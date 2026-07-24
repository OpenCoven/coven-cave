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

console.log("journal-generate.test.ts: ok");
