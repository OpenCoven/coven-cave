// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./route.ts", import.meta.url), "utf8");

assert.match(
  source,
  /import \{ CAVE_HOME_MIGRATIONS, migrateCaveHome \} from "@\/lib\/server\/cave-home-migration"/,
  "POST must reuse the boot-time migration implementation, not a parallel one",
);
assert.match(
  source,
  /import \{ caveHomeMigrationStatus \} from "@\/lib\/server\/cave-home-migration-status"/,
  "qualification comes from the shared status module",
);
assert.match(
  source,
  /export async function GET\(req: Request\)[\s\S]*?rejectNonLocalRequest\(req\)[\s\S]*?status: await caveHomeMigrationStatus\(\)/,
  "GET reports pending/conflicts/migrated status for the banner qualification check",
);
assert.match(
  source,
  /export async function POST\(req: Request\)[\s\S]*?rejectNonLocalRequest\(req\)[\s\S]*?await migrateCaveHome\(options\)/,
  "POST runs the transactional reconciliation with validated options",
);
assert.match(
  source,
  /const status = await caveHomeMigrationStatus\(\);/,
  "POST re-checks status after running so the client can clear or retry",
);
assert.match(
  source,
  /ok: result\.errors\.length === 0/,
  "POST ok reflects whether the migration finished without errors",
);
assert.match(source, /force-dynamic/, "status must never be served from the route cache");
assert.match(source, /ACTIONS = new Set<ReconciliationAction>/, "review actions are allowlisted");
assert.match(source, /Unknown legacy migration entry/, "action requests are restricted to the shared manifest");
assert.match(source, /req\.body[\s\S]*readJsonBody<[^>]+>\(req, MAX_ACTION_BODY_BYTES\)[\s\S]*: null/, "actions are bounded while body-less legacy POST requests remain compatible");

console.log("cave-home-migration route.test.ts: ok");
