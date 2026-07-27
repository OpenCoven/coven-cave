// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./inspector-pane.tsx", import.meta.url), "utf8");

// Canonical list loading goes through the shared cache and the same
// force/background/unmount request-ownership primitive as the full memory
// surface. No direct canonical fetch or weaker local boolean guard is allowed.
assert.match(
  src,
  /loadCanonicalMemoryList\(force\)/,
  "Inspector canonical list uses the shared resource loader",
);
assert.doesNotMatch(
  src,
  /fetch\(\s*["'`]\/api\/coven-memory/,
  "Inspector must not fetch the canonical list directly",
);
assert.match(
  src,
  /createMemoryFeedRequestGate\(\)/,
  "canonical list publication reuses the shared request-ownership gate",
);
assert.match(
  src,
  /force\s*\?\s*requestGate\.beginForce\(\)\s*:\s*requestGate\.beginBackground\("canonical"\)/,
  "forced refresh supersedes background canonical publication",
);
assert.match(
  src,
  /requestGate\.isCurrent\(request\)/,
  "canonical results publish only for the current mounted request",
);
assert.match(
  src,
  /canonicalRequestGate\.unmount\(\)/,
  "unmount invalidates outstanding canonical publications",
);

// Readiness is a privacy boundary, but speculative/concurrent renders must
// stay pure. The committed effect owns request invalidation and state reset;
// render only masks canonical state directly from the readiness prop.
const memoryTabRenderSetup = src.slice(
  src.indexOf("function MemoryTab"),
  src.indexOf("const applyCanonicalList"),
);
assert.doesNotMatch(
  memoryTabRenderSetup,
  /\.current\s*=|set[A-Z]\w*\(/,
  "MemoryTab must not mutate refs or state while rendering",
);
assert.doesNotMatch(
  src,
  /canonicalReadinessRef/,
  "readiness publication ownership must not depend on a render-mutated ref",
);
assert.match(
  src,
  /const canonicalState = localDaemonReady\s*\?\s*storedCanonicalState\s*:\s*EMPTY_CANONICAL_LIST_STATE/,
  "localDaemonReady synchronously masks every prior canonical publication",
);
assert.match(
  src,
  /useEffect\(\(\) => \{\s*setStoredCanonicalState\(EMPTY_CANONICAL_LIST_STATE\);[\s\S]{0,500}if \(!localDaemonReady\) \{\s*return;\s*\}[\s\S]{0,200}canonicalRequestGate\.mount\(\);[\s\S]{0,120}void loadCanonical\(\);[\s\S]{0,200}return \(\) => \{\s*canonicalRequestGate\.unmount\(\);\s*\};\s*\}, \[canonicalRequestGate, loadCanonical, localDaemonReady\]\);/,
  "a committed readiness effect resets state, mounts/loads only when ready, and invalidates through cleanup",
);
assert.equal(
  (src.match(/canonicalRequestGate\.unmount\(\)/g) ?? []).length,
  1,
  "the canonical gate is invalidated only by committed effect cleanup",
);

// The per-familiar file list and open-file contents are real fetches and must
// abort on supersession/unmount.
const abortControllers = src.match(/new AbortController\(\)/g) ?? [];
assert.ok(abortControllers.length >= 2, "both Files loaders own AbortControllers");

assert.match(
  src,
  /fetch\(\s*url,\s*\{\s*cache:\s*"no-store",\s*signal:\s*controller\.signal,?\s*\}/,
  "the per-familiar memory list fetch is abortable",
);
assert.match(
  src,
  /\/api\/memory\/file\?path[\s\S]*?signal:\s*controller\.signal[\s\S]*?setOpenFile\(json\)/,
  "the open-file loader is abortable and publishes only the selected file",
);
assert.ok(
  (src.match(/controller\.abort\(\)/g) ?? []).length >= 2,
  "both Files effects abort during cleanup",
);

// Detail cancellation is inherited from the exact shared reader. Pin both the
// integration and its already-behavioral cancellation contract.
assert.match(
  src,
  /<CanonicalMemoryReader[\s\S]*memoryId=\{selectedCanonicalId\}/,
  "Inspector delegates canonical detail to the shared reader",
);
const reader = readFileSync(new URL("./canonical-memory-reader.tsx", import.meta.url), "utf8");
assert.match(
  reader,
  /return \(\) => \{\s*current = false;\s*controller\.abort\(\);\s*\};/,
  "shared detail reader aborts on ID change and unmount",
);

// Readiness is computed once by Workspace and threaded into the rail. It must
// never be inferred from a successful list response inside Inspector.
const workspace = readFileSync(new URL("./workspace.tsx", import.meta.url), "utf8");
assert.match(
  workspace,
  /<RailInspector[\s\S]*localDaemonReady=\{localDaemonReady\}/,
  "Workspace threads strict local readiness into RailInspector",
);
assert.match(
  src,
  /<InspectorPane[\s\S]*localDaemonReady=\{localDaemonReady\}/,
  "RailInspector threads strict local readiness into InspectorPane",
);
assert.doesNotMatch(
  src,
  /setLocalDaemonReady|canonicalEntries\.length\s*[>!?]/,
  "Inspector never infers canonical readiness locally",
);

// The Familiar tab's capability panel (extracted to chat-familiar-capabilities.tsx)
// awaits four fetches with one Promise.all — same rule: a slow response must
// not setState after cleanup, even though the keyed host remounts per familiar.
const familiarView = readFileSync(new URL("./chat-familiar-capabilities.tsx", import.meta.url), "utf8");
assert.match(familiarView, /let cancelled = false;/, "the capability loader declares a cancelled guard");
assert.match(
  familiarView,
  /\.then\(\(\[rolesRes, skillsRes, capsRes, harnessesRes\]\) => \{\s*if \(cancelled\) return;/,
  "the capability loader drops stale/post-unmount responses before any setState",
);
assert.match(familiarView, /return \(\) => \{ cancelled = true; \};/, "the capability loader cleans up by cancelling in-flight work");

console.log("inspector-pane-load-guards.test.ts: ok");
