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
  "nested MemoryTab shell should paint the base background behind the Files empty state",
);

// The canonical vault was ID-only: it never carried a filesystem path, and a
// canonical row could never reach the file viewer. The vault lives in the
// dedicated memory application now, so those guards have no subject — but the
// path-hygiene rules they sat beside are about the inspector itself and still
// bind.
assert.doesNotMatch(source, /\/Users\/[a-z]/i, "no hardcoded developer home path in the inspector");
assert.doesNotMatch(source, /NEXT_PUBLIC_COVEN_MEMORY_ROOT/, "no client-side memory-root path guessing");
assert.doesNotMatch(
  source,
  /CanonicalMemoryReader|canonicalMemoryErrorCopy|selectedCanonicalId|localDaemonReady/,
  "the vault reader, its error copy, its selection and its local-daemon gate are all retired",
);
assert.doesNotMatch(
  source,
  /mode === "coven"|<Tabs/,
  "with one memory source left there is no mode to switch between",
);
assert.match(
  source,
  /<MemoryTab\s+key=\{familiar\?\.id \?\? "all"\}/,
  "a familiar change synchronously remounts the memory state so prior details cannot paint",
);

assert.match(
  source,
  /filtered\.slice\(0,\s*200\)\.map\(\(entry\)[\s\S]*setOpenPath\(entry\.fullPath\)/,
  "Files rows retain the server-resolved fullPath viewer",
);
assert.match(
  source,
  /function MemoryFileView[\s\S]*openGrimoireDoc\("memory", path\)/,
  "Files retain their Grimoire action",
);
assert.match(
  source,
  /function MemoryFileView[\s\S]*reveal secrets/,
  "Files retain the redacted/reveal viewer",
);

console.log("inspector-pane-surface.test.ts OK");
