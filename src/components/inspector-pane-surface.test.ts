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

// Canonical memory is ID-only and delegates detail/privacy/Markdown policy to
// the shared reader. Files keep the allow-listed fullPath viewer below.
assert.doesNotMatch(source, /\/Users\/[a-z]/i, "no hardcoded developer home path in the inspector");
assert.doesNotMatch(source, /NEXT_PUBLIC_COVEN_MEMORY_ROOT/, "no client-side memory-root path guessing");
assert.match(
  source,
  /CanonicalMemoryReader,[\s\S]{0,120}from "@\/components\/canonical-memory-reader"/,
  "Inspector must reuse the exact shared canonical reader policy",
);
assert.match(
  source,
  /import type \{ CanonicalMemorySummary \} from "@\/lib\/canonical-memory"/,
  "canonical rows use the path-free shared summary DTO",
);
assert.doesNotMatch(source, /type CovenMemoryEntry\b/, "legacy path-bearing canonical rows are removed");
assert.doesNotMatch(source, /familiar_id|updated_at/, "canonical rows use the canonical DTO field names");
assert.match(
  source,
  /const \[selectedCanonicalId,\s*setSelectedCanonicalId\]\s*=\s*useState<string \| null>\(null\)/,
  "canonical selection stores only the opaque ID",
);
assert.match(
  source,
  /<CanonicalMemoryReader[\s\S]*memoryId=\{selectedCanonicalId\}[\s\S]*localDaemonReady=\{localDaemonReady\}/,
  "selected opaque IDs and explicit local readiness reach the shared reader",
);
assert.match(
  source,
  /<MemoryTab\s+key=\{familiar\?\.id \?\? "all"\}/,
  "a familiar change synchronously remounts the memory state so prior details cannot paint",
);
assert.match(
  source,
  /canonicalMemoryErrorCopy\(canonicalState\.error\.code\)\.subtitle/,
  "canonical list failures use the approved safe recovery copy",
);
assert.doesNotMatch(
  source,
  /hint=\{canonicalState\.error\.code\}/,
  "canonical error codes are not exposed as user-facing diagnostic text",
);
const canonicalRowsSource = source.slice(
  source.indexOf("canonicalFiltered.map"),
  source.indexOf('{mode === "files"'),
);
assert.doesNotMatch(
  canonicalRowsSource,
  /setOpenPath|openGrimoireDoc|(?:path|fullPath)/,
  "canonical rows never enter the file viewer",
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
