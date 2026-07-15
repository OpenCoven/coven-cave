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

// This rollup polls the same heavy /api/sessions/list as the shell, so it must
// pause while the user is typing — otherwise it re-introduces the mobile typing
// lag the shell polls were gated to avoid.
assert.match(
  source,
  /usePausablePoll\(\(\) => void load\(\), POLL_MS, \{ pauseWhileInputActive: true \}\)/,
  "the sessions poll pauses during active input composition",
);

// The poll is guarded like every other polled surface: a monotonic reqId drops
// a superseded overlapping load, and arrayContentEqual keeps the previous
// reference when an idle tick rebuilds an identical list (no needless re-render
// of this always-mounted sidebar rollup).
assert.match(source, /const loadReqRef = useRef\(0\)/, "the rollup poll tracks a request id");
assert.match(source, /const reqId = \+\+loadReqRef\.current;/, "each load bumps the request id");
assert.match(source, /if \(reqId !== loadReqRef\.current\) return;/, "a superseded load drops its writes");
assert.match(source, /setSessions\(\(prev\) => \(arrayContentEqual\(prev, next\) \? prev : next\)\)/, "an unchanged poll keeps the previous sessions reference");

console.log("recent-activity-rollup.test.ts: ok");
