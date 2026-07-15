import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function exactHeadingPattern(heading) {
  const escapedHeading = heading.replace(/[.*+?^\${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escapedHeading}$`, "m");
}

const designLanguage = readFileSync(
  new URL("../docs/coven-design-language.md", import.meta.url),
  "utf8",
);

assert.match(
  designLanguage,
  /Section 10 is authoritative for interface language/,
  "Section 10 is the interface language authority",
);

const vocabularyHeading = exactHeadingPattern("### Vocabulary");
assert.match(
  "### Vocabulary",
  vocabularyHeading,
  "exact heading matcher accepts the intended heading",
);
assert.doesNotMatch(
  "#### Vocabulary",
  vocabularyHeading,
  "exact heading matcher rejects demoted headings",
);
assert.doesNotMatch(
  "### Vocabulary and tone",
  vocabularyHeading,
  "exact heading matcher rejects suffixed headings",
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
    exactHeadingPattern(heading),
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
  /A\s+placeholder\s+never\s+replaces\s+a\s+persistent\s+label/,
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
