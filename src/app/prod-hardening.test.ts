import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

// [1] Windows path normalization must use a SINGLE backslash. The prior
// `replace(/\//g, "\\\\")` emitted doubled backslashes, producing malformed
// paths that broke the spawn cwd + the allow-list comparison on Windows.
const scope = read("../lib/chat-runtime-scope.ts");
assert.doesNotMatch(scope, /\\{4,}/, "chat-runtime-scope has no doubled-backslash Windows path replacement");
assert.match(scope, /SINGLE backslash/, "the Windows path fix documents single-backslash normalization");

// [2] Board quick-add create() must surface failures, not silently drop them
// (the caller `void`s the promise). It guards the parse and shows the banner.
const board = read("../components/board-view.tsx");
assert.match(
  board,
  /const create = async \(draft[\s\S]*?try \{[\s\S]*?setActionError\(/,
  "board create() surfaces errors via the inline error banner",
);
assert.match(board, /res\.json\(\)\.catch\(/, "board create() guards the response parse against non-JSON");

// [3] App-level error boundaries so a thrown component recovers instead of
// white-screening the app on any distribution.
for (const f of ["./error.tsx", "./global-error.tsx"]) {
  const s = read(f);
  assert.match(s, /"use client";/, `${f} is a client component`);
  assert.match(s, /export default function/, `${f} exports a default error boundary`);
  assert.match(s, /reset\(\)/, `${f} offers a reset/recovery action`);
}
assert.match(read("./global-error.tsx"), /<html/, "global-error renders its own document (root-layout failures)");

console.log("prod-hardening guard passed");
