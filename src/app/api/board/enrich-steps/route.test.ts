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
