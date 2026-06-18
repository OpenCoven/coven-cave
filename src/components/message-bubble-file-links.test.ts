// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const { FILE_REF_RE } = await import("../lib/file-ref.ts");

// ── FILE_REF_RE: matches real file refs, ignores ordinary prose/code ─────────
const matches = (s) => FILE_REF_RE.exec(s);
{
  // Relative + absolute paths, with/without :line[:col].
  assert.ok(matches("src/foo.ts"), "relative path");
  assert.equal(matches("lib/bar.py:42")[1], "lib/bar.py", "path captured without the :line");
  assert.equal(matches("lib/bar.py:42")[2], "42", "line captured");
  assert.ok(matches("a/b/c.tsx:10:5"), "path:line:col");
  assert.ok(matches("package.json"), "bare config file");
  assert.ok(matches("README.md"), "bare doc file");
  assert.ok(matches("/Users/x/app/index.html"), "absolute path");

  // NOT file refs — must never linkify ordinary prose / shell / numbers.
  assert.equal(matches("npm install"), null, "command with space");
  assert.equal(matches("e.g."), null, "abbreviation");
  assert.equal(matches("foo()"), null, "function call");
  assert.equal(matches("3.14"), null, "number");
  assert.equal(matches("foo.bar"), null, "unknown extension");
  assert.equal(matches("https://example.com"), null, "url");
  assert.equal(matches("just some text"), null, "prose");
}

// ── wiring ───────────────────────────────────────────────────────────────────
const bubble = await readFile(new URL("./message-bubble.tsx", import.meta.url), "utf8");
const comux = await readFile(new URL("./comux-view.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../styles/cave-chat.css", import.meta.url), "utf8");

// Linkify only inline code, never fenced-block lines.
assert.match(
  bubble,
  /code\.closest\("pre"\) \|\| code\.closest\("\.cave-code-wrap"\)\) continue/,
  "only inline code is linkified (fenced blocks skipped)",
);
assert.match(
  bubble,
  /dispatchEvent\(new CustomEvent\("cave:open-project-file", \{ detail: \{ path, line \} \}\)\)/,
  "clicking a file ref opens it in the Code workspace",
);
// Chat prose enables linkify; the shared MarkdownBlock must NOT.
assert.match(bubble, /useWireCopyButtons\(html, onOpenUrl, true\)/, "MarkdownContent (chat) enables linkifyPaths");
assert.match(bubble, /const containerRef = useWireCopyButtons\(html\);/, "MarkdownBlock keeps linkify off (default)");

// comux resolves relative refs against the selected project root.
assert.match(
  comux,
  /detail\.path\.startsWith\("\/"\)[\s\S]*?selectedRoot[\s\S]*?\$\{detail\.path\.replace\(\/\^\\\.\?\\\/\/, ""\)\}/,
  "relative prose paths resolve against the selected project root",
);

// Affordance styling exists.
assert.match(css, /code\.cave-file-link \{[\s\S]*?cursor: pointer/, "file-link affordance is styled");

console.log("message-bubble-file-links.test.ts: ok");
