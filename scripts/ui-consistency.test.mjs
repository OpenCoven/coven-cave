import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const designLanguage = readFileSync(
  new URL("../docs/coven-design-language.md", import.meta.url),
  "utf8",
);

for (const heading of [
  "## 10. Interface copy and field contract",
  "### Vocabulary",
  "### Action copy",
  "### Field semantics",
  "### Placeholder grammar",
  "### State copy",
]) {
  assert.match(
    designLanguage,
    new RegExp(heading.replace(/[.*+?^\${}()|[\]\\]/g, "\\$&")),
    `design language contains ${heading}`,
  );
}

assert.match(
  designLanguage,
  /\*\*Tasks\*\* is the top-level user-facing noun/,
  "Tasks is the canonical destination noun",
);
assert.match(
  designLanguage,
  /A placeholder never replaces a persistent label/,
  "placeholder-only labeling is forbidden",
);
assert.match(
  designLanguage,
  /`Search <items>…`/,
  "search placeholder grammar is explicit",
);
assert.match(
  designLanguage,
  /\*\*Couldn't load <object>\*\*/,
  "failure grammar names the failed object",
);

console.log("ui-consistency.test.mjs: copy contract ok");
