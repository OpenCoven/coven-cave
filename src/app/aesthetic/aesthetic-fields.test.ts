// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("./aesthetic.css", import.meta.url), "utf8");

for (const imported of ["Field", "TextInput", "TextArea"]) {
  assert.match(page, new RegExp(`\\b${imported}\\b`), `aesthetic imports ${imported}`);
}

assert.match(page, /<Section title="Fields">/, "reference exposes a Fields section");
assert.match(
  page,
  /className="shell-card aesthetic-field-grid"/,
  "field matrix uses its reference-page class",
);
assert.doesNotMatch(
  page.match(/<Section title="Fields">[\s\S]*?<\/Section>/)?.[0] ?? "",
  /\bstyle=\{/,
  "field matrix does not increase static inline-style drift",
);
assert.match(
  css,
  /\.aesthetic-field-grid[\s\S]*gap:\s*var\(--space-5\)[\s\S]*padding:\s*var\(--space-5\)/,
  "field matrix spacing uses design tokens",
);
assert.match(
  page,
  /label="Project name"[\s\S]*description="Use the name people recognize in task and chat pickers\."[\s\S]*required/,
  "required described state is visible",
);
assert.match(
  page,
  /label="Summary"[\s\S]*optional[\s\S]*<TextArea/,
  "optional multiline state is visible",
);
assert.match(
  page,
  /label="Repository path"[\s\S]*error="Enter an absolute project path"/,
  "invalid state is visible",
);
assert.match(page, /label="Saved owner"[\s\S]*readOnly/, "read-only state is visible");
assert.match(
  page,
  /label="Unavailable runtime"[\s\S]*disabled/,
  "disabled state is visible",
);
assert.match(
  page,
  /placeholder="e\.g\., Coven Cave"/,
  "example placeholder follows the contract",
);
assert.match(
  page,
  /placeholder="Describe the task…"/,
  "intent placeholder uses a true ellipsis",
);

console.log("aesthetic-fields.test.ts: ok");
