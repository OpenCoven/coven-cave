// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { classifyDiffLine, parseDiff, diffStats, diffLineClass } from "./gh-diff.ts";

// ── classifyDiffLine ─────────────────────────────────────────────────────────
assert.equal(classifyDiffLine("+added"), "add", "plus → add");
assert.equal(classifyDiffLine("-removed"), "del", "minus → del");
assert.equal(classifyDiffLine(" context"), "context", "space → context");
assert.equal(classifyDiffLine("plain"), "context", "no marker → context");
assert.equal(classifyDiffLine("@@ -1,3 +1,4 @@ fn()"), "meta", "hunk header → meta");
assert.equal(classifyDiffLine("diff --git a/x b/x"), "meta", "diff --git → meta");
assert.equal(classifyDiffLine("--- a/x"), "meta", "--- file header → meta (not a deletion)");
assert.equal(classifyDiffLine("+++ b/x"), "meta", "+++ file header → meta (not an addition)");

// ── parseDiff: line numbers track across the @@ header ────────────────────────
const patch = [
  "@@ -10,3 +10,4 @@ function foo() {",
  " const a = 1;",
  "-const b = 2;",
  "+const b = 3;",
  "+const c = 4;",
  " return a;",
].join("\n");
const lines = parseDiff(patch);
assert.equal(lines.length, 6, "parses every line including the header");
assert.equal(lines[0].type, "meta", "first row is the hunk header");
assert.deepEqual([lines[0].oldNo, lines[0].newNo], [null, null], "header has no line numbers");
// context line starts both counters at 10
assert.deepEqual([lines[1].type, lines[1].oldNo, lines[1].newNo], ["context", 10, 10], "context numbered on both sides");
// deletion advances old only
assert.deepEqual([lines[2].type, lines[2].oldNo, lines[2].newNo], ["del", 11, null], "deletion numbered on the old side only");
// additions advance new only
assert.deepEqual([lines[3].type, lines[3].oldNo, lines[3].newNo], ["add", null, 11], "first addition numbered on the new side only");
assert.deepEqual([lines[4].type, lines[4].oldNo, lines[4].newNo], ["add", null, 12], "second addition increments the new side");
// trailing context continues from where add/del left the counters
assert.deepEqual([lines[5].oldNo, lines[5].newNo], [12, 13], "trailing context resumes both counters");

// ── diffStats ────────────────────────────────────────────────────────────────
assert.deepEqual(diffStats(lines), { additions: 2, deletions: 1 }, "counts adds and dels, ignores context/meta");
assert.deepEqual(diffStats(parseDiff("")), { additions: 0, deletions: 0 }, "empty patch → zero stats");
assert.equal(parseDiff("").length, 0, "empty patch → no rows");

// ── diffLineClass ────────────────────────────────────────────────────────────
assert.match(diffLineClass("add"), /gh-diff__line--add/, "add class");
assert.match(diffLineClass("del"), /gh-diff__line--del/, "del class");
assert.match(diffLineClass("meta"), /gh-diff__line--meta/, "meta class");
assert.match(diffLineClass("context"), /gh-diff__line--ctx/, "context class");

// ── Wiring: the renderer is used where GitHub review content lands ────────────
const ghView = readFileSync(new URL("../components/github-view.tsx", import.meta.url), "utf8");
assert.match(ghView, /import \{ DiffHunk \} from "@\/components\/gh-diff-view"/, "github-view imports DiffHunk");
assert.match(ghView, /<DiffHunk hunk=\{thread\.diffHunk\}/, "review threads render the diff via DiffHunk, not a raw <pre>");
assert.match(ghView, /<DiffHunk hunk=\{thread\.diffHunk\} path=\{thread\.path\}/, "review threads pass the file path so the diff can pick a Shiki grammar");
assert.doesNotMatch(ghView, /thread\.diffHunk\.split\("\\n"\)\.slice\(-4\)/, "the old raw last-4-lines <pre> is gone");

const diffView = readFileSync(new URL("../components/gh-diff-view.tsx", import.meta.url), "utf8");
assert.match(diffView, /export function DiffHunk/, "exports DiffHunk");
assert.match(diffView, /parseDiff/, "DiffHunk parses the hunk");

// ── Wiring: syntax highlighting rides the shared app-wide Shiki singleton ─────
assert.match(
  diffView,
  /import \{ getShikiHighlighter \} from "@\/lib\/shiki-highlighter"/,
  "DiffHunk highlights through the shared Shiki singleton (no second createHighlighter instance)",
);
assert.doesNotMatch(diffView, /createHighlighter\(/, "DiffHunk must not create its own Shiki instance");
assert.match(
  diffView,
  /resolveShikiLang\(pathLangToken\(path\)\)/,
  "the diff grammar resolves from the file path via the basename-aware token helper",
);
assert.match(
  diffView,
  /const base = path\.split\("\/"\)\.pop\(\) \?\? "";/,
  "pathLangToken extracts the basename first so extensionless names in subdirs (infra/Dockerfile) still resolve",
);
assert.match(
  diffView,
  /return dot > 0 \? base\.slice\(dot \+ 1\) : base;/,
  "pathLangToken falls back to the bare basename when there is no extension",
);
assert.match(
  diffView,
  /if \(lang === "text" \|\| lines\.length === 0\) return;/,
  "unknown grammars skip the highlight pass entirely (plain text render, no WASM load)",
);
assert.match(
  diffView,
  /l\.type === "meta" \? "" : splitMarker\(l\.text\)\.content/,
  "hunk is highlighted as one document with meta rows blanked so tokens stay line-aligned",
);
assert.match(
  diffView,
  /className="gh-diff__marker" aria-hidden/,
  "the +/-/context marker renders in its own non-copyable span so diff and token coloring compose",
);
assert.match(diffView, /if \(!cancelled\) setTokens\(result\.tokens\);/, "async highlight lands behind a cancelled guard");

const bubbleView = readFileSync(new URL("../components/message-bubble.tsx", import.meta.url), "utf8");
assert.match(
  bubbleView,
  /import \{ getShikiHighlighter \} from "@\/lib\/shiki-highlighter"/,
  "chat code fences share the same Shiki singleton as the diff renderer",
);

console.log("gh-diff.test.ts: ok");
