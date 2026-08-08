// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

assert.match(
  source,
  /if \(result\.ok \|\| result\.code === "retro_state_unavailable"\) \{\s*return NextResponse\.json\(\{ ok: true, snapshot: result\.snapshot \}\);\s*\}/,
  "retro-runs GET should preserve the public ok:true snapshot response for unavailable retro state loads",
);

assert.match(
  source,
  /return NextResponse\.json\(\{ ok: false, error: result\.error, snapshot: result\.snapshot \}\);/,
  "retro-runs GET should expose only the sanitized top-level roster error contract",
);

console.log("retro-runs route.test.ts: ok");
