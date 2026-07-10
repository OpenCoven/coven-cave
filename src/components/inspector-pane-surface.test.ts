// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./inspector-pane.tsx", import.meta.url), "utf8");

assert.match(
  source,
  /const shellClassName = compact[\s\S]*bg-\[var\(--bg-base\)\]/,
  "compact InspectorPane should use the same base rail surface as Chat and Memory",
);

assert.doesNotMatch(
  source,
  /<aside className="flex h-full flex-col border-l border-\[var\(--border-hairline\)\] bg-\[var\(--bg-raised\)\]\/40">/,
  "compact InspectorPane must not always inherit the bordered translucent standalone shell",
);

assert.match(
  source,
  /inspector-memory-tab-surface flex h-full min-h-0 flex-col bg-\[var\(--bg-base\)\]/,
  "nested MemoryTab mode shell should paint the base background behind Coven and Files empty states",
);

// Memory "open file" affordance must use the SERVER-resolved, allow-listed path —
// never a hardcoded developer home dir (which broke on every non-dev machine).
assert.doesNotMatch(source, /\/Users\/[a-z]/i, "no hardcoded developer home path in the inspector");
assert.doesNotMatch(source, /NEXT_PUBLIC_COVEN_MEMORY_ROOT/, "no client-side memory-root path guessing");
assert.match(source, /setOpenPath\(e\.fullPath!?\)/, "the memory open-file button opens the server-resolved fullPath");
assert.match(source, /\{e\.fullPath \? \(/, "the open-file affordance only renders when the server attached an allow-listed fullPath");

console.log("inspector-pane-surface.test.ts OK");
