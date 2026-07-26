import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// useFamiliarContracts is the cockpit's insight-row raw material: per-familiar
// contract reports + thread self-reports (the thread-confidence source) + the
// shared retro-runs snapshot, fanned out with a bound so a large coven can't
// stampede the daemon (cave-hwux — extracted from the dashboard-cockpit root's
// inline effect).
const src = readFileSync(new URL("./use-familiar-contracts.ts", import.meta.url), "utf8");

assert.match(src, /CONTRACT_FETCH_CAP = 12/, "contract fan-out stays bounded at 12 familiars");
assert.match(
  src,
  /familiars\.slice\(0, CONTRACT_FETCH_CAP\)/,
  "the cap truncates the familiar set before any URL is built",
);
assert.match(
  src,
  /partial = familiars\.length > fetchedCount/,
  "`partial` is true exactly when the cap left familiars unscored — callers surface honest coverage",
);
assert.match(src, /\/api\/retro-runs/, "one shared retro-runs snapshot rides the same batch");
assert.match(
  src,
  /`\/api\/familiars\/\$\{encodeURIComponent\(id\)\}\/contract`/,
  "per-familiar contract endpoint, id URL-encoded",
);
// Thread self-reports ride the same bounded batch — the cockpit scores
// confidence from real reflections (deriveThreadConfidence), and the fetch
// window matches the analytics page's (limit=30).
assert.match(src, /SELF_REPORT_FETCH_LIMIT = 30/, "self-report window matches the analytics page");
assert.match(
  src,
  /`\/api\/familiars\/\$\{encodeURIComponent\(id\)\}\/self-reports\?limit=\$\{SELF_REPORT_FETCH_LIMIT\}`/,
  "per-familiar self-reports endpoint, id URL-encoded",
);
assert.match(src, /cache: "no-store"/, "contract data is live — never the HTTP cache");
// One effect-scoped cancelled guard covers both unmount and a key change; the
// old inline version needed a second component-level aliveRef plus an
// exhaustive-deps disable.
assert.match(src, /let alive = true/, "effect-scoped cancelled guard exists");
assert.match(src, /if \(!alive\) return/, "a stale batch (unmount or familiar-set change) is dropped");
assert.match(src, /alive = false/, "cleanup cancels the in-flight batch");
assert.doesNotMatch(src, /eslint-disable/, "no exhaustive-deps escape hatch — the key is the only dep");
assert.match(src, /\}, \[key\]\);/, "refetch is keyed on the visible familiar-id set");
assert.match(
  src,
  /if \(!key\)[\s\S]{0,40}setContracts\(null\)/,
  "an empty roster resets to null instead of fetching",
);
// Failed fetches resolve null (never throw) so one bad familiar can't sink
// the whole Promise.all batch.
assert.match(src, /if \(!res\.ok\) return null/, "non-OK responses resolve null");
assert.match(src, /catch \{\s*return null;/, "network errors resolve null");
assert.match(src, /contractReports\[i\]\?\.report \?\? null/, "a missing contract is stored as an explicit null row");
assert.match(src, /selfReports\[i\]\?\.reports \?\? \[\]/, "a missing self-report list degrades to empty — unmeasured, not broken");

console.log("use-familiar-contracts.test.ts: ok");
