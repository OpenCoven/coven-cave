// @ts-nocheck
/**
 * Source pins for SSE chunk coalescing in the chat stream loop (cave-w50e).
 *
 * SSE delivers ~one assistant_chunk frame per token; before this change each
 * frame triggered a full turns map + registry advance + React commit —
 * 50-100 commits/second on fast models. The stream loop now buffers chunk
 * text in a coalescer and flushes it at most every CHUNK_FLUSH_MS, while
 * non-chunk events and stream end/error force an immediate flush so ordering
 * between text and progress/attachment/done records — and the final text —
 * are exactly what they were before.
 *
 * Behavior of the buffer itself is covered in src/lib/chunk-coalescer.test.ts;
 * these pins keep the chat-view wiring honest.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./chat-view.tsx", import.meta.url), "utf8");

// ── 1. The stream loop routes chunks through the coalescer ──────────────────
assert.match(
  src,
  /if \(ev\.kind === "assistant_chunk"\) \{[\s\S]{0,200}?chunkCoalescer\.push\(ev\.text\);/,
  "assistant_chunk frames must be buffered, not committed per frame",
);

// ── 2. Non-chunk events flush buffered text FIRST (ordering) ────────────────
assert.match(
  src,
  /\} else \{[\s\S]{0,300}?chunkCoalescer\.flush\(\);\s*\n\s*handleEvent\(ev, assistantId, request, liveGeneration\);/,
  "any non-chunk event must flush buffered text before it is handled — text vs progress/attachment ordering is load-bearing",
);

// ── 3. Stream end flushes ────────────────────────────────────────────────────
assert.match(
  src,
  /\n\s*\}\s*\n\s*chunkCoalescer\.flush\(\);\s*\n\s*\} catch \(err\) \{/,
  "normal stream end must flush the tail of the buffer",
);

// ── 4. The error/abort path flushes before reading t.text ───────────────────
assert.match(
  src,
  /\} catch \(err\) \{[\s\S]{0,300}?chunkCoalescer\.flush\(\);[\s\S]{0,300}?AbortError/,
  "abort/error handling must flush first — the cancelled fallback reads t.text and must see all streamed text",
);

// ── 5. The coalescer is declared outside the try so the catch can flush ─────
assert.match(
  src,
  /const chunkCoalescer = createChunkCoalescer\(\{\s*\n\s*flushMs: CHUNK_FLUSH_MS,\s*\n\s*apply: \(text\) => applyAssistantChunk\(text, assistantId, liveGeneration\),/,
  "the coalescer applies through applyAssistantChunk with the send's own liveGeneration",
);

// ── 6. One application path: the extracted applyAssistantChunk ───────────────
assert.match(
  src,
  /const applyAssistantChunk = \(\s*\n\s*text: string,/,
  "the chunk application is extracted so coalesced and direct paths share one implementation",
);
assert.match(
  src,
  /case "assistant_chunk": \{[\s\S]{0,400}?applyAssistantChunk\(ev\.text, assistantId, liveGeneration\);/,
  "handleEvent's assistant_chunk case must delegate to the shared implementation (never drop a chunk)",
);
// The heavy inline per-chunk map must not return to the switch case.
const chunkCase = src.slice(src.indexOf('case "assistant_chunk"'), src.indexOf('case "assistant_chunk"') + 600);
assert.ok(
  !chunkCase.includes("appendCollapsingNewlines"),
  "the per-frame switch case must stay a thin delegate — the text append lives in applyAssistantChunk",
);

// ── 7. The flush window is short enough to be imperceptible ─────────────────
const flushMs = src.match(/const CHUNK_FLUSH_MS = (\d+);/);
assert.ok(flushMs, "CHUNK_FLUSH_MS constant exists");
const ms = Number(flushMs[1]);
assert.ok(ms >= 15 && ms <= 100, `CHUNK_FLUSH_MS (${ms}) must batch meaningfully (>=15ms) but stay imperceptible (<=100ms)`);

// ── 8. Timer-based, not rAF — chunks keep landing after unmount/hide ────────
const coalescerLib = readFileSync(new URL("../lib/chunk-coalescer.ts", import.meta.url), "utf8");
assert.ok(
  !coalescerLib.includes("requestAnimationFrame("),
  "the coalescer must use timers — rAF stalls in hidden windows and the registry accumulates post-unmount",
);

console.log("chat-view-chunk-coalescing.test.ts: ok");
