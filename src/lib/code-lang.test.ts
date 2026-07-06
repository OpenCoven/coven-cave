// @ts-nocheck
import assert from "node:assert/strict";
import {
  SHIKI_LANGS,
  resolveShikiLang,
  isHighlightableLang,
  resolveLangLabel,
  diffContentLang,
} from "./code-lang.ts";

// ---------------------------------------------------------------------------
// The bug this module fixes: the Projects file preview feeds Shiki a bare file
// EXTENSION ("ts", "tsx", "rs"), but the highlighter only bundles canonical
// ids ("typescript", "rust"). Unmapped tokens silently fall back to "text",
// which renders monochrome. Every extension below MUST resolve to a real
// grammar, never "text".
// ---------------------------------------------------------------------------

const EXTENSION_EXPECTATIONS: Array<[string, string]> = [
  ["ts", "typescript"],
  ["mts", "typescript"],
  ["cts", "typescript"],
  ["tsx", "tsx"],
  ["js", "javascript"],
  ["mjs", "javascript"],
  ["cjs", "javascript"],
  ["jsx", "jsx"],
  ["py", "python"],
  ["rs", "rust"],
  ["rb", "ruby"],
  ["sh", "bash"],
  ["zsh", "bash"],
  ["yml", "yaml"],
  ["yaml", "yaml"],
  ["md", "markdown"],
  ["mdx", "markdown"],
  ["kt", "kotlin"],
  ["h", "c"],
  ["hpp", "cpp"],
  ["cc", "cpp"],
  ["gql", "graphql"],
  ["ex", "elixir"],
  ["hs", "haskell"],
  ["clj", "clojure"],
  ["fs", "fsharp"],
  ["json", "json"],
  ["toml", "toml"],
  ["css", "css"],
  ["go", "go"],
];

for (const [ext, expected] of EXTENSION_EXPECTATIONS) {
  assert.equal(
    resolveShikiLang(ext),
    expected,
    `extension "${ext}" should resolve to "${expected}" (not silently fall back to text)`,
  );
}

// Canonical ids pass straight through.
for (const lang of SHIKI_LANGS) {
  assert.equal(resolveShikiLang(lang), lang, `canonical id "${lang}" should resolve to itself`);
}

// Tolerant of casing, leading dots, and `lang:filename` fence syntax.
assert.equal(resolveShikiLang("TS"), "typescript", "uppercase extension should normalize");
assert.equal(resolveShikiLang(".rs"), "rust", "leading dot should be stripped");
assert.equal(resolveShikiLang("  python  "), "python", "surrounding whitespace should be trimmed");
assert.equal(resolveShikiLang("ts:server.ts"), "typescript", "lang:filename fence syntax should resolve the lang half");

// Unknown / empty input is the safe text fallback — never throws.
assert.equal(resolveShikiLang("wingdings"), "text", "unknown token falls back to text");
assert.equal(resolveShikiLang(""), "text", "empty string falls back to text");
assert.equal(resolveShikiLang(null), "text", "null falls back to text");
assert.equal(resolveShikiLang(undefined), "text", "undefined falls back to text");

// isHighlightableLang mirrors the resolution.
assert.equal(isHighlightableLang("ts"), true, "ts is highlightable");
assert.equal(isHighlightableLang("lock"), false, "an unknown ext is not highlightable");
assert.equal(isHighlightableLang(null), false, "null is not highlightable");

// Every alias target must itself be a loadable grammar — otherwise the alias
// would just relocate the silent text fallback. This guards the table.
for (const lang of SHIKI_LANGS) {
  // resolving a canonical id must be idempotent (already covered) — here we
  // assert the resolved value is always a member of SHIKI_LANGS.
  assert.ok(
    (SHIKI_LANGS as readonly string[]).includes(resolveShikiLang(lang)),
    `resolveShikiLang(${lang}) must be a bundled grammar`,
  );
}
for (const [ext] of EXTENSION_EXPECTATIONS) {
  assert.ok(
    (SHIKI_LANGS as readonly string[]).includes(resolveShikiLang(ext)),
    `resolveShikiLang(${ext}) must be a bundled grammar`,
  );
}

// ---------------------------------------------------------------------------
// Display labels — surfaced as the preview-header badge.
// ---------------------------------------------------------------------------

assert.equal(resolveLangLabel("ts"), "TypeScript", "ts → TypeScript label");
assert.equal(resolveLangLabel("tsx"), "TSX", "tsx → TSX label");
assert.equal(resolveLangLabel("rs"), "Rust", "rs → Rust label");
assert.equal(resolveLangLabel("py"), "Python", "py → Python label");
assert.equal(resolveLangLabel("fs"), "F#", "fs → F# label");
// Unknown but short extension keeps an honest uppercased badge.
assert.equal(resolveLangLabel("lock"), "LOCK", "unknown short ext shows uppercased badge");
assert.equal(resolveLangLabel("env"), "ENV", "env shows uppercased badge");
assert.equal(resolveLangLabel(""), "Text", "empty input shows Text");

// ---------------------------------------------------------------------------
// diffContentLang — grammar for the code INSIDE a unified diff, from headers.
// ---------------------------------------------------------------------------

assert.equal(
  diffContentLang("--- a/src/lib/foo.ts\n+++ b/src/lib/foo.ts\n-old\n+new"),
  "typescript",
  "ts target → typescript grammar",
);
assert.equal(
  diffContentLang("+++ b//Users/buns/repo/src/lib/stream-events.ts\n+import x"),
  "typescript",
  "write-style diff with absolute (double-slash) path resolves",
);
assert.equal(
  diffContentLang("--- /dev/null\n+++ b/pkg/main.rs\n+fn main() {}"),
  "rust",
  "/dev/null old side is skipped; new side wins",
);
assert.equal(
  diffContentLang("--- a/Dockerfile\n+++ b/Dockerfile\n+FROM node"),
  "dockerfile",
  "extensionless well-known basename resolves via its bare name",
);
assert.equal(
  diffContentLang("--- a/foo.xyzzy\n+++ b/foo.xyzzy\n+data"),
  "text",
  "unknown extension falls back to text (flat diff grammar)",
);
assert.equal(diffContentLang("+just\n-lines"), "text", "no headers → text");
assert.equal(
  diffContentLang("--- a/change.diff\n+++ b/change.diff\n+--- x"),
  "text",
  "a .diff target keeps flat mode (no diff-in-diff recursion)",
);
assert.equal(
  diffContentLang("+++ b/src/app.py\t2026-07-06 12:00:00\n+x = 1"),
  "python",
  "trailing tab+timestamp after the path is tolerated",
);

console.log("code-lang.test.ts ✓");
