// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./board-view.tsx", import.meta.url), "utf8");

assert.match(
  source,
  /fetch\("\/api\/board\/enrich-steps", \{[\s\S]*method: "POST"[\s\S]*"content-type": "application\/json"[\s\S]*"x-coven-cave-intent": "board-enrich-steps"[\s\S]*body: JSON\.stringify\(\{ intent: "board-enrich-steps" \}\)/,
  "Board enrich client should send an intentional JSON request with a non-simple header",
);
