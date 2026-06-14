// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

assert.match(
  source,
  /export async function POST\(req: Request\)/,
  "Enrich route should receive the Request so it can validate intent and observe aborts",
);

assert.match(
  source,
  /req\.headers\.get\("x-coven-cave-intent"\) !== "board-enrich-steps"/,
  "Enrich route should reject requests without the non-simple intent header",
);

assert.match(
  source,
  /await req\.json\(\)[\s\S]*body\.intent === "board-enrich-steps"/,
  "Enrich route should require the matching JSON intent body",
);

assert.match(
  source,
  /signal\.addEventListener\("abort", onAbort, \{ once: true \}\)/,
  "Coven child process should be killed if the client aborts",
);

assert.match(
  source,
  /if \(req\.signal\.aborted\) break;/,
  "Enrich route should stop iterating cards after abort",
);

assert.match(
  source,
  /await resolveFamiliarWorkspace\(familiarId\)/,
  "Enrich route should run each familiar from its familiar workspace",
);

assert.match(
  source,
  /"--archive"[\s\S]*"--labels"[\s\S]*"board,enrich-steps"/,
  "One-shot enrichment runs should be archived and labeled",
);

assert.match(
  source,
  /type TaskEnrichment = \{[\s\S]*steps\?: string\[\][\s\S]*status\?: CardStatus[\s\S]*lifecycle\?: CardLifecycle[\s\S]*priority\?: CardPriority/,
  "Enrich route should parse a full task metadata payload, not only step strings",
);

assert.match(
  source,
  /const STATUS_VALUES = new Set<CardStatus>\(/,
  "Enrich route should validate returned status values against board statuses",
);

assert.match(
  source,
  /const LIFECYCLE_VALUES = new Set<CardLifecycle>\(/,
  "Enrich route should validate returned lifecycle values against board lifecycles",
);

assert.match(
  source,
  /const PRIORITY_VALUES = new Set<CardPriority>\(/,
  "Enrich route should validate returned priority values against board priorities",
);

assert.match(
  source,
  /const candidates = board\.cards\.filter\([\s\S]*c\.familiarId[\s\S]*!SKIP_LIFECYCLE\.has\(c\.lifecycle\)[\s\S]*\);/,
  "Enrich route should revisit every active assigned task, including tasks that already have steps",
);

assert.doesNotMatch(
  source,
  /const candidates = board\.cards\.filter\([\s\S]*\(c\.steps \?\? \[\]\)\.length === 0[\s\S]*\);/,
  "Enrich route should not skip active tasks only because steps already exist",
);

assert.match(
  source,
  /await updateCard\(card\.id, \{[\s\S]*steps:[\s\S]*status:[\s\S]*lifecycle:[\s\S]*priority:[\s\S]*needsHuman:[\s\S]*lifecycleReason:/,
  "Enrich route should update steps, status, lifecycle, priority, and human/lifecycle metadata together",
);
