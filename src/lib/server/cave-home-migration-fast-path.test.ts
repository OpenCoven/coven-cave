// @ts-nocheck
// Steady-state reconciliation must classify entries with cheap stats instead
// of re-hashing canonical stores on every startup (cave-573l). These probes
// pin the lazy-hash contract: journal entries for settled bridges carry no
// content hashes, and an unreadable child deep inside a canonical directory
// cannot fail a startup that never needed to read it.
import assert from "node:assert/strict";
import { chmod, lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const roots: string[] = [];
const { migrateCaveHome } = await import("./cave-home-migration.ts");
const { caveHomeMigrationStatus } = await import("./cave-home-migration-status.ts");

async function home(name: string) {
  const root = await mkdtemp(path.join(tmpdir(), `cave-home-${name}-`));
  roots.push(root);
  process.env.COVEN_HOME = path.join(root, ".coven");
  delete process.env.COVEN_CAVE_HOME;
  delete process.env.COVEN_PREFERENCES_PATH;
  delete process.env.COVEN_THEME_PATH;
  delete process.env.COVEN_BACKDROP_PATH;
  await mkdir(process.env.COVEN_HOME, { recursive: true });
  return { root, coven: process.env.COVEN_HOME, cave: path.join(process.env.COVEN_HOME, "cave") };
}

async function json(target: string) {
  return JSON.parse(await readFile(target, "utf8"));
}

async function kind(target: string) {
  try {
    const value = await lstat(target);
    return value.isSymbolicLink() ? "symlink" : value.isDirectory() ? "dir" : "file";
  } catch {
    return "missing";
  }
}

// Symlink bridges and chmod-based read denial behave differently on Windows;
// the fast path itself is platform-neutral and covered on the POSIX runners.
if (process.platform === "win32") {
  console.log("cave-home-migration-fast-path.test.ts: ok (skipped on win32)");
} else {
  try {
    // A settled compatibility bridge is journaled from stats alone: re-running
    // reconciliation must not record content hashes for the linked entry.
    {
      const { coven, cave } = await home("lazy-journal");
      await mkdir(path.join(coven, "cave-conversations"), { recursive: true });
      await writeFile(path.join(coven, "cave-conversations", "one.json"), JSON.stringify({ id: "one" }));
      globalThis.__caveHomeMigration = undefined;
      const first = await migrateCaveHome();
      assert.deepEqual(first.errors, []);
      assert.ok(first.moved.includes("cave-conversations"));
      assert.equal(await kind(path.join(coven, "cave-conversations")), "symlink");

      const second = await migrateCaveHome();
      assert.deepEqual(second.errors, []);
      const entry = (await json(path.join(cave, "migration-state.json"))).entries["cave-conversations"];
      assert.equal(entry.decision, "linked");
      assert.equal(entry.legacyHash, undefined);
      assert.equal(entry.canonicalHash, undefined);
      assert.equal((await caveHomeMigrationStatus()).migrated, true);
    }

    // An unreadable child deep inside an already-canonical store must not fail
    // steady-state reconciliation or status: neither ever needs its bytes. The
    // eager-hash implementation digested the whole directory and threw EACCES.
    if (typeof process.getuid === "function" && process.getuid() === 0) {
      console.log("skipping unreadable-canonical probe: running as root bypasses file modes");
    } else {
      const { coven, cave } = await home("unreadable-canonical");
      await mkdir(path.join(coven, "cave-conversations"), { recursive: true });
      await writeFile(path.join(coven, "cave-conversations", "one.json"), JSON.stringify({ id: "one" }));
      globalThis.__caveHomeMigration = undefined;
      assert.deepEqual((await migrateCaveHome()).errors, []);

      const locked = path.join(cave, "conversations", "locked");
      await mkdir(locked, { recursive: true });
      await writeFile(path.join(locked, "secret.json"), JSON.stringify({ id: "secret" }));
      await chmod(locked, 0o000);
      try {
        const steady = await migrateCaveHome();
        assert.deepEqual(steady.errors, []);
        assert.ok(steady.skipped.includes("cave-conversations"));
        assert.equal((await caveHomeMigrationStatus()).migrated, true);
      } finally {
        await chmod(locked, 0o755);
      }
    }

    console.log("cave-home-migration-fast-path.test.ts: ok");
  } finally {
    for (const root of roots) await rm(root, { recursive: true, force: true });
  }
}
