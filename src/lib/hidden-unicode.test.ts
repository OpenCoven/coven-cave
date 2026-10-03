import assert from "node:assert/strict";
import {
  codePointLabel,
  describeHiddenUnicode,
  hasHiddenUnicode,
  revealHiddenUnicodeInHtml,
  splitHiddenUnicode,
} from "./hidden-unicode.ts";

// Hidden characters in names and code (#5781).

// A right-to-left override that listed `invoice‮gnp.exe` as "invoiceexe.png".
assert.equal(codePointLabel("‮"), "U+202E");
assert.equal(describeHiddenUnicode("src/invoice‮gnp.exe"), "src/invoice⟨U+202E⟩gnp.exe");
assert.deepEqual(splitHiddenUnicode("invoice‮gnp.exe", "name"), [
  { text: "invoice", hidden: false },
  { text: "‮", hidden: true, label: "U+202E" },
  { text: "gnp.exe", hidden: false },
]);

// A zero-width space that made `a​b.ts` look like `ab.ts`, and each bidi
// isolate and embedding control.
assert.equal(describeHiddenUnicode("a​b.ts"), "a⟨U+200B⟩b.ts");
for (const char of ["؜", "‎", "‏", "‪", "‫", "‬", "‭", "⁦", "⁧", "⁨", "⁩", "⁠", "﻿"]) {
  assert.ok(hasHiddenUnicode(`x${char}y`, "name"), `${codePointLabel(char)} counts in a name`);
  assert.ok(hasHiddenUnicode(`x${char}y`, "code"), `${codePointLabel(char)} counts in code`);
}

// Plain names and code have none, including non-Latin scripts and emoji
// sequences, whose joiners and variation selectors are left alone.
for (const text of ["src/flux.ts", "café.ts", "日本語.md", "👩‍💻 refactor", "❤️ notes", "ملف.txt", "क्‍ष"]) {
  assert.equal(hasHiddenUnicode(text, "name"), false, text);
  assert.equal(describeHiddenUnicode(text), text, text);
}

// A newline or tab is hidden in a name, ordinary in code.
assert.equal(describeHiddenUnicode("new\nline.ts"), "new⟨U+000A⟩line.ts");
assert.equal(describeHiddenUnicode("a\tb"), "a⟨U+0009⟩b");
assert.equal(hasHiddenUnicode("const a = 1;\n\tconst b = 2;\r\n", "code"), false);
assert.equal(hasHiddenUnicode("bell\u0007", "code"), true);

// A byte-order mark opening a file is ordinary; anywhere else it isn't.
assert.equal(hasHiddenUnicode("﻿const a = 1;", "code"), false);
assert.equal(hasHiddenUnicode("const a﻿ = 1;", "code"), true);

// The pattern is global: repeated calls don't carry `lastIndex` between them.
for (let i = 0; i < 3; i++) assert.equal(hasHiddenUnicode("a‮b", "name"), true);

// In HTML, only text changes: each character keeps its place inside an
// isolating span, and tags and attributes are left as they were.
const shiki = '<pre class="shiki" style="color:#fff" tabindex="0"><code><span style="color:#888">/*‮ } ⁦if (isAdmin)⁩ */</span></code></pre>';
const revealed = revealHiddenUnicodeInHtml(shiki);
assert.equal(
  revealed,
  '<pre class="shiki" style="color:#fff" tabindex="0"><code><span style="color:#888">/*'
    + '<span class="cave-hidden-char" data-cp="U+202E">‮</span> } '
    + '<span class="cave-hidden-char" data-cp="U+2066">⁦</span>if (isAdmin)'
    + '<span class="cave-hidden-char" data-cp="U+2069">⁩</span> */</span></code></pre>',
);
assert.equal(revealHiddenUnicodeInHtml("<span>plain</span>\n<span>code</span>"), "<span>plain</span>\n<span>code</span>");

console.log("hidden-unicode: ok");
