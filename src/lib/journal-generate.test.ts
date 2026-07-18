// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildReflectionPrompt } from "./journal-generate.ts";

{
  const p = buildReflectionPrompt("2026-06-20: 2 responses.\n- Reply to Sage");
  assert.match(p, /first-person/i, "asks for a first-person reflection");
  assert.match(p, /2026-06-20: 2 responses/, "embeds the provided context");
  assert.match(p, /Reply to Sage/, "embeds the item titles");
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

console.log("journal-generate.test.ts: ok");
