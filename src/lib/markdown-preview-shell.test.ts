import assert from "node:assert/strict";
import { unwrapPreviewShell } from "./markdown-preview-shell.ts";

// ── strips the outer shell so blocks are direct children of .cave-md ────────
{
  const html = '<div class="cm-preview"><p class="cm-paragraph">Intro:</p>\n<ul class="cm-bullet-list">\n<li>one</li>\n</ul></div>';
  assert.equal(
    unwrapPreviewShell(html),
    '<p class="cm-paragraph">Intro:</p>\n<ul class="cm-bullet-list">\n<li>one</li>\n</ul>',
  );
}

// ── inner divs survive — only the single outer shell goes ────────────────────
{
  const html = '<div class="cm-preview"><p>a</p><div class="cave-table-scroll"><table></table></div></div>';
  assert.equal(
    unwrapPreviewShell(html),
    '<p>a</p><div class="cave-table-scroll"><table></table></div>',
  );
}

// ── tolerates surrounding whitespace from sanitizer round-trips ──────────────
{
  assert.equal(unwrapPreviewShell('  <div class="cm-preview"><p>x</p></div>\n'), "<p>x</p>");
}

// ── non-shell HTML passes through untouched ──────────────────────────────────
{
  assert.equal(unwrapPreviewShell("<p>plain</p>"), "<p>plain</p>");
  assert.equal(unwrapPreviewShell(""), "");
  const partial = '<div class="cm-preview"><p>unclosed</p>';
  assert.equal(unwrapPreviewShell(partial), partial, "an unterminated shell is left alone");
}

// ── the real pipeline shape: parse → renderAsync emits the shell ─────────────
{
  // Minimal custom-element shims so @create-markdown/preview loads in node.
  (globalThis as Record<string, unknown>).HTMLElement = class {};
  (globalThis as Record<string, unknown>).customElements = { define: () => {}, get: () => undefined };
  const [{ parse }, { renderAsync }] = await Promise.all([
    import("@create-markdown/core"),
    import("@create-markdown/preview"),
  ]);
  const html = await renderAsync(parse("Intro:\n- one\n- two"), {});
  const unwrapped = unwrapPreviewShell(html);
  assert.match(html, /^<div class="cm-preview">/, "renderAsync emits the shell this module exists to strip");
  assert.doesNotMatch(unwrapped, /cm-preview/, "the shell is gone");
  assert.match(unwrapped, /^<p class="cm-paragraph">Intro:<\/p>\n<ul class="cm-bullet-list">/, "paragraph and list become top-level siblings");
}

console.log("markdown-preview-shell.test.ts passed");
