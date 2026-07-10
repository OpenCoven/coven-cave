// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const { FILE_REF_RE, resolveFileRefTarget } = await import("../lib/file-ref.ts");

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

// ── resolveFileRefTarget: only real project files are openable ───────────────
{
  const root = "/repo/app";
  const files = new Set(["src/foo.ts", "docs/guide.md"]);
  assert.equal(resolveFileRefTarget({ path: "src/foo.ts" }, root, files), "src/foo.ts", "indexed relative path resolves");
  assert.equal(resolveFileRefTarget({ path: "./src/foo.ts" }, root, files), "src/foo.ts", "leading ./ is normalized");
  assert.equal(resolveFileRefTarget({ path: "/repo/app/docs/guide.md" }, root, files), "docs/guide.md", "absolute path under the root resolves to its repo-relative form");
  assert.equal(resolveFileRefTarget({ path: "src/missing.ts" }, root, files), null, "a path absent from the index never resolves");
  assert.equal(resolveFileRefTarget({ path: "/elsewhere/foo.ts" }, root, files), null, "an absolute path outside the root never resolves");
  assert.equal(resolveFileRefTarget({ path: "src/foo.ts" }, null, files), null, "no project root ⇒ nothing resolves");
  assert.equal(resolveFileRefTarget({ path: "src/foo.ts" }, root, null), null, "no index ⇒ nothing resolves (strict: unverified refs stay plain text)");
}

// ── wiring ───────────────────────────────────────────────────────────────────
const bubble = await readFile(new URL("./message-bubble.tsx", import.meta.url), "utf8");
const chatView = await readFile(new URL("./chat-view.tsx", import.meta.url), "utf8");
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
// A ref is only linkified when the surface's resolver confirms the click can
// open it; wiring reconciles (adds AND removes the affordance) so a resolver
// change never leaves a stale clickable ref.
assert.match(bubble, /const want = Boolean\(ref && resolve\?\.\(ref\)\)/, "linkify is gated on the resolver approving the ref");
assert.match(bubble, /_caveFileLinkCleanup = \(\) => \{[\s\S]*?removeEventListener\("click", open\)[\s\S]*?classList\.remove\("cave-file-link"\)/, "wiring keeps a cleanup so a rejected ref is un-linkified in place");
// Chat prose supplies the resolver via context; the shared MarkdownBlock must NOT.
assert.match(bubble, /const fileLinkResolver = useContext\(FileLinkResolverContext\)/, "MarkdownContent reads the resolver from FileLinkResolverContext");
assert.match(bubble, /const containerRef = useWireCopyButtons\(html\);/, "MarkdownBlock keeps linkify off (default)");
// ChatView provides the resolver over its transcript, backed by the project
// file index, so links only render for files that exist under the session root.
assert.match(chatView, /<FileLinkResolverContext\.Provider value=\{fileLinkResolver\}>/, "chat transcript provides the file-link resolver");
assert.match(chatView, /resolveFileRefTarget\(ref, transcriptFileRoot, fileRefIndex\.files\) != null/, "the chat resolver verifies refs against the fetched project file index");
// The tool file chip needs the code rail (a project root) to open anything —
// no root ⇒ plain text, not a dead button.
assert.match(chatView, /targetFile && railRoot \? \(/, "tool file chips are gated on a project root");

// Affordance styling exists.
assert.match(css, /code\.cave-file-link \{[\s\S]*?cursor: pointer/, "file-link affordance is styled");

// (ComuxView's project-switch-on-open pins left with the component, cave-c3yt.)
const tree = await readFile(new URL("./project-tree.tsx", import.meta.url), "utf8");
// The tree auto-expands ancestors of the selected file so the highlight shows.
assert.match(
  tree,
  /selectedPath\.startsWith\(`\$\{entry\.path\}\/`\)/,
  "tree reveals the selected file by expanding its ancestor folders",
);

console.log("message-bubble-file-links.test.ts: ok");
