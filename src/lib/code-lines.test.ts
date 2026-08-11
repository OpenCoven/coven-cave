// @ts-nocheck
import assert from "node:assert/strict";

const { splitHighlightedLines, escapeHtml } = await import("./code-lines.ts");

// A Shiki block splits into one fragment per source line, with the trailing
// empty fragment (Shiki terminates the last line with a newline) dropped so no
// phantom row renders.
{
  const html = '<pre class="shiki"><code><span class="line">a</span>\n<span class="line">b</span>\n</code></pre>';
  const lines = splitHighlightedLines(html, "a\nb");
  assert.deepEqual(lines, ['<span class="line">a</span>', '<span class="line">b</span>']);
}

// A single line with no trailing newline still yields one row.
{
  const html = '<pre class="shiki"><code><span class="line">only</span></code></pre>';
  assert.deepEqual(splitHighlightedLines(html, "only"), ['<span class="line">only</span>']);
}

// Attributes on <code> (Shiki emits style/tabindex) do not defeat the match.
{
  const html = '<pre tabindex="0"><code style="color:#fff"><span>x</span>\n</code></pre>';
  assert.deepEqual(splitHighlightedLines(html, "x"), ["<span>x</span>"]);
}

// Blank interior lines survive as empty rows — dropping them would misalign
// every line number after the blank.
{
  const html = "<pre><code>a\n\nb\n</code></pre>";
  assert.deepEqual(splitHighlightedLines(html, "a\n\nb"), ["a", "", "b"]);
}

// Not-a-Shiki-block falls back to the escaped source rather than an empty
// panel, so a caller that hands us plain text still gets addressable rows.
{
  const lines = splitHighlightedLines("no code element here", "let x = 1 < 2;\nsecond");
  assert.deepEqual(lines, ["let x = 1 &lt; 2;", "second"]);
}

// An empty highlighted body falls back too rather than rendering nothing.
{
  assert.deepEqual(splitHighlightedLines("<pre><code></code></pre>", "src"), ["src"]);
}

// CRLF input does not produce trailing carriage returns in the fallback.
{
  assert.deepEqual(splitHighlightedLines("plain", "a\r\nb"), ["a", "b"]);
}

// Escaping covers the characters that could break out of an attribute or tag.
{
  assert.equal(escapeHtml(`<a href="x">&</a>`), "&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;");
  assert.equal(escapeHtml("plain"), "plain");
}
