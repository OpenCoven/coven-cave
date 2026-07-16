// @ts-nocheck
import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

if (process.platform !== "win32") {
  console.log("cave-home-migration-windows.test.ts: skipped (not Windows)");
  process.exit(0);
}

const root = await mkdtemp(path.join(tmpdir(), "cave-home-windows-"));
process.env.COVEN_HOME = path.join(root, ".coven");
delete process.env.COVEN_CAVE_HOME;

const { migrateCaveHome } = await import("../src/lib/server/cave-home-migration.ts");
const { caveHomeMigrationStatus } = await import("../src/lib/server/cave-home-migration-status.ts");

try {
  await mkdir(process.env.COVEN_HOME, { recursive: true });
  const legacy = path.join(process.env.COVEN_HOME, "cave-config.json");
  const canonical = path.join(process.env.COVEN_HOME, "cave", "config.json");
  await writeFile(legacy, '{"windows":true}', "utf8");
  const result = await migrateCaveHome();
  assert.deepEqual(result.errors, []);
  assert.deepEqual(JSON.parse(await readFile(canonical, "utf8")), { windows: true });
  const bridge = await lstat(legacy);
  assert.ok(bridge.isSymbolicLink() || bridge.isFile(), "Windows uses a link when permitted or an ordinary managed mirror");
  assert.equal((await caveHomeMigrationStatus()).migrated, true, "compatibility bridge never creates a false conflict");
  console.log("cave-home-migration-windows.test.ts: ok");
} finally {
  await rm(root, { recursive: true, force: true });
}
