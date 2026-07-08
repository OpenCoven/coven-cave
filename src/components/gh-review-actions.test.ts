// @ts-nocheck
// Source-text test for PR review action controls.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./gh-review-actions.tsx", import.meta.url), "utf8");

assert.match(source, /StandardSelect/, "review familiar picker uses the shared custom select");
assert.match(source, /label="Familiar to review with"/, "review picker has an accessible label");
assert.doesNotMatch(source, /<select[\s\S]*>/, "PR review actions no longer uses native <select>");
assert.match(source, /familiar\.display_name/, "review actions displays familiar names in the picker");

// cave-o7jc: familiars load async, so the useState initializer captures "" on the
// first render — an effect backfills the first familiar once the list arrives, or
// the "Review with" button (disabled on !familiarId) stays permanently dead.
assert.match(
  source,
  /useEffect\(\(\) => \{\s*\n\s*if \(!familiarId && familiars\[0\]\) setFamiliarId\(familiars\[0\]\.id\);\s*\n\s*\}, \[familiars, familiarId\]\)/,
  "the review picker backfills the first familiar once familiars load (not left disabled)",
);

console.log("gh-review-actions.test.ts OK");
