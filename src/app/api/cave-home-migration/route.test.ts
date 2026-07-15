// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./route.ts", import.meta.url), "utf8");

assert.match(
  source,
  /import \{ migrateCaveHome \} from "@\/lib\/server\/cave-home-migration"/,
  "POST must reuse the boot-time migration implementation, not a parallel one",
);
assert.match(
  source,
  /import \{ caveHomeMigrationStatus \} from "@\/lib\/server\/cave-home-migration-status"/,
  "qualification comes from the shared status module",
);
assert.match(
  source,
  /export async function GET\(\)[\s\S]*?status: await caveHomeMigrationStatus\(\)/,
  "GET reports pending/conflicts/migrated status for the banner qualification check",
);
assert.match(
  source,
  /export async function POST\(\)[\s\S]*?await migrateCaveHome\(\)/,
  "POST runs the idempotent migration on demand",
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

console.log("cave-home-migration route.test.ts: ok");
