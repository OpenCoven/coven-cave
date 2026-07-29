import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./dashboard/bento-dashboard.tsx", import.meta.url), "utf8");

assert.match(
  source,
  /activityCollectionsComplete\(act\.collections\)/,
  "the dashboard must consume activity completeness metadata",
);
assert.match(
  source,
  /githubComplete:\s*boolean \| null/,
  "the dashboard distinguishes loading, complete, and incomplete GitHub data",
);
assert.match(
  source,
  /requestFailed[\s\S]{0,500}?d\.github/,
  "failed polls retain last-known GitHub rows instead of replacing them with an empty slice",
);
assert.match(
  source,
  /data\.githubComplete === false \? "activity incomplete"/,
  "empty incomplete activity is disclosed instead of rendered as nothing assigned",
);
assert.match(
  source,
  /data\.githubComplete === true[\s\S]{0,200}?\$\{data\.github\.length\}\+ open items/,
  "partial GitHub counts are not rendered as exact totals",
);
assert.doesNotMatch(
  source,
  /\/api\/github\/assigned/,
  "the dashboard must not merge an independently capped GitHub feed into a complete activity count",
);
assert.match(
  source,
  /githubRetryUntilRef/,
  "the dashboard retains the GitHub rate-limit cooldown between polls",
);
assert.match(
  source,
  /activityRetryAfterSeconds\(act\.collections\)/,
  "the dashboard reads category Retry-After metadata before scheduling another GitHub request",
);

console.log("bento-dashboard.test.ts: ok");
