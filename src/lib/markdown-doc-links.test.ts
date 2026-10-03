import assert from "node:assert/strict";
import { handleMarkdownLinkClick, markdownLinkTarget } from "./markdown-doc-links.ts";

// Links in a rendered README or PR description stay in the app (#5781).
const file = "/repo/app/docs/README.md";
const root = "/repo/app";

assert.deepEqual(markdownLinkTarget("https://example.com/x", file, root), { kind: "external", url: "https://example.com/x" });
assert.deepEqual(markdownLinkTarget("HTTP://EXAMPLE.COM", file, root), { kind: "external", url: "HTTP://EXAMPLE.COM" });
assert.deepEqual(markdownLinkTarget("#install", file, root), { kind: "fragment" });
// Relative to the document, then from the project root for a leading slash.
assert.deepEqual(markdownLinkTarget("guide.md", file, root), { kind: "file", path: "/repo/app/docs/guide.md" });
assert.deepEqual(markdownLinkTarget("./guide.md#setup", file, root), { kind: "file", path: "/repo/app/docs/guide.md" });
assert.deepEqual(markdownLinkTarget("../src/index.ts?plain=1", file, root), { kind: "file", path: "/repo/app/src/index.ts" });
assert.deepEqual(markdownLinkTarget("/CONTRIBUTING.md", file, root), { kind: "file", path: "/repo/app/CONTRIBUTING.md" });
assert.deepEqual(markdownLinkTarget("my%20notes.md", file, root), { kind: "file", path: "/repo/app/docs/my notes.md" });
// Out of the project, malformed, or not the web: nothing.
for (const href of ["../../../etc/passwd", "../../outside.md", "javascript:alert(1)", "mailto:a@b.c", "data:text/html,x", "//evil.example/x", "%E0%A4%A", "", "   "]) {
  assert.deepEqual(markdownLinkTarget(href, file, root), { kind: "none" }, href);
}
// Without a document (a PR description), only web links and fragments.
assert.deepEqual(markdownLinkTarget("docs/x.md"), { kind: "none" });
assert.deepEqual(markdownLinkTarget("https://github.com/a/b"), { kind: "external", url: "https://github.com/a/b" });

// The click handler: prevents the anchor's own navigation, except a fragment.
function click(href: string, prevented = false) {
  const anchor = { getAttribute: () => href };
  const target = { closest: (selector: string) => (selector === "a[href]" ? anchor : null) };
  const calls: string[] = [];
  const event = { target, defaultPrevented: prevented, prevented: false, preventDefault() { this.prevented = true; } };
  handleMarkdownLinkClick(event as never, {
    filePath: file,
    projectRoot: root,
    openExternal: (url) => calls.push(`external ${url}`),
    openFile: (path) => calls.push(`file ${path}`),
  });
  return { prevented: event.prevented, calls };
}
assert.deepEqual(click("https://example.com"), { prevented: true, calls: ["external https://example.com"] });
assert.deepEqual(click("guide.md"), { prevented: true, calls: ["file /repo/app/docs/guide.md"] });
assert.deepEqual(click("javascript:alert(1)"), { prevented: true, calls: [] });
assert.deepEqual(click("#section"), { prevented: false, calls: [] });
assert.deepEqual(click("https://example.com", true), { prevented: false, calls: [] }, "someone else handled it");

console.log("markdown-doc-links: ok");
