import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./dashboard/bento-dashboard.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../styles/bento-dashboard.css", import.meta.url), "utf8");

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
  /requestFailed[\s\S]{0,700}?d\.github/,
  "failed polls retain last-known GitHub rows instead of replacing them with an empty slice",
);
assert.match(
  source,
  /failedKinds[\s\S]{0,700}?d\.github/,
  "failed activity categories retain their last-known rows while successful categories refresh",
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
assert.match(
  source,
  /retryAfterSeconds[\s\S]{0,500}?githubRetryUntilRef\.current/,
  "top-level GitHub backpressure delays dashboard polling",
);
assert.match(
  css,
  /\.bd-heat-grid \{[\s\S]{0,180}?grid-auto-columns: 1fr;/,
  "adaptive heatmap columns divide the available width evenly",
);
assert.match(
  css,
  /\.bd-heat-cell \{[\s\S]{0,100}?height: 9px;/,
  "adaptive heatmap cells keep a compact fixed height",
);
assert.doesNotMatch(
  css.match(/\.bd-heat-cell \{[^}]*\}/)?.[0] ?? "",
  /aspect-ratio/,
  "wider short-history cells do not make the activity section taller",
);

console.log("bento-dashboard.test.ts: ok");
