// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./recent-activity-rollup.tsx", import.meta.url), "utf8");

// The collapse state persists across reloads and remounts via localStorage,
// but defaults to open for SSR / first paint so the markup hydrates cleanly.
assert.match(
  source,
  /const \[open, setOpen\] = useState\(true\)/,
  "defaults to open for SSR + first client paint (avoids a hydration mismatch)",
);
assert.match(
  source,
  /localStorage\.getItem\(OPEN_STORAGE_KEY\)[\s\S]{0,120}?setOpen\(stored !== "false"\)/,
  "hydrates the saved open/collapsed preference after mount",
);
assert.match(
  source,
  /localStorage\.setItem\(OPEN_STORAGE_KEY, String\(next\)\)/,
  "persists the preference whenever the user toggles the section",
);
assert.match(
  source,
  /onClick=\{toggleOpen\}/,
  "the header toggle writes through the persisting handler",
);

console.log("recent-activity-rollup.test.ts: ok");
