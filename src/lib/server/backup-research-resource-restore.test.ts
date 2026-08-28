import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { buildBackupArchive, restoreBackupArchive } from "./backup-archive.ts";
import { listCompatibleResearchLinks } from "./research-links-compatibility.ts";
import { writeResearchLinksVerified } from "./research-links-legacy-store.ts";
import { createResearchResourceStore } from "./research-resource-store.ts";
import { openResearchResourceLexicalIndex } from "./research-resource-lexical-index.ts";
import {
  recoverInterruptedResearchResourceRestore,
  researchResourceRestoreMarkerPath,
} from "./research-resource-recovery.ts";

function waitForLine(child: ChildProcessWithoutNullStreams, expected: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let buffered = "";
    let errors = "";
    const onData = (chunk: Buffer) => {
      buffered += chunk.toString("utf8");
      if (!buffered.split(/\r?\n/).includes(expected)) return;
      cleanup();
      resolve();
    };
    const onExit = (code: number | null) => {
      cleanup();
      reject(new Error(`restore lock child exited ${code} before ${expected}: ${buffered}${errors}`));
    };
    const onErrorData = (chunk: Buffer) => { errors += chunk.toString("utf8"); };
    const cleanup = () => {
      child.stdout.off("data", onData);
      child.stderr.off("data", onErrorData);
      child.off("exit", onExit);
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onErrorData);
    child.on("exit", onExit);
  });
}

const parent = await mkdtemp(path.join(os.tmpdir(), "cave-backup-research-restore-"));
const originalCovenHome = process.env.COVEN_HOME;
const originalCaveHome = process.env.COVEN_CAVE_HOME;

try {
  const sourceHome = path.join(parent, "source", ".coven");
  const sourceCave = path.join(sourceHome, "cave");
  const sourceResources = path.join(sourceCave, "research-resources");
  const sourceLegacy = path.join(sourceCave, "research-links.json");
  process.env.COVEN_HOME = sourceHome;
  delete process.env.COVEN_CAVE_HOME;
  await mkdir(sourceCave, { recursive: true, mode: 0o700 });
  await writeResearchLinksVerified({
    version: 1,
    links: [{
      id: "restore-link",
      url: "https://example.com/recovery",
      title: "Recovery evidence",
      category: "article",
      addedAt: "2026-08-27T12:00:00.000Z",
      source: "desk",
    }],
  }, { path: sourceLegacy });
  await listCompatibleResearchLinks({ resourceRoot: sourceResources, legacyPath: sourceLegacy });

  const { archive, manifest } = await buildBackupArchive("research restore passphrase");
  assert.ok(manifest.entries.some((entry) => entry.path.startsWith("research-resources/manifests/")));
  assert.ok(manifest.entries.some((entry) => entry.path === "research-resources/migration/research-links-projection.json"));

  const targetHome = path.join(parent, "target", ".coven");
  process.env.COVEN_HOME = targetHome;
  const targetResources = path.join(targetHome, "cave", "research-resources");
  await mkdir(path.join(targetResources, "manifests"), { recursive: true, mode: 0o700 });
  await mkdir(path.join(targetResources, "blobs", "sha256", "ff"), { recursive: true, mode: 0o700 });
  await writeResearchLinksVerified({ version: 1, links: [] }, {
    path: path.join(targetHome, "cave", "research-links.json"),
  });
  await Promise.all([
    writeFile(path.join(targetResources, "manifests", "stale.json"), "stale authority", { mode: 0o600 }),
    writeFile(path.join(targetResources, "blobs", "sha256", "ff", "stale"), "stale private bytes", { mode: 0o600 }),
  ]);
  const lexicalFile = path.join(targetResources, "index", "research-resources.sqlite");
  await mkdir(path.dirname(lexicalFile), { recursive: true, mode: 0o700 });
  const staleAuthority = {
    resourceId: "stale-resource",
    resourceRevision: 1,
    deletionRevision: 0,
    snapshotId: "stale-snapshot",
    snapshotDigest: "a".repeat(64),
  };
  const preopenedLexical = await openResearchResourceLexicalIndex({ file: lexicalFile });
  preopenedLexical.replace({
    ...staleAuthority,
    normalizedBytes: new TextEncoder().encode("stale lexical plaintext"),
  });
  await assert.rejects(
    () => restoreBackupArchive(archive, "research restore passphrase", {
      researchFailpoint: async () => {
        await assert.rejects(() => lstat(lexicalFile), /ENOENT/);
        assert.throws(
          () => preopenedLexical.probe(staleAuthority, "stale"),
          /unavailable while backup restore recovery is incomplete/,
          "a canonical handle opened before restore cannot serve unlinked stale lexical data",
        );
        assert.equal(
          await lstat(path.join(targetResources, "manifests", "stale.json")).then(() => true),
          true,
          "lexical state is unavailable before the first authority write or prune",
        );
        throw new Error("injected early recovery failure");
      },
    }),
    /injected early recovery failure/,
  );
  await assert.rejects(
    () => openResearchResourceLexicalIndex({ file: lexicalFile }),
    /unavailable while backup restore recovery is incomplete/,
    "an early recovery failure leaves stale lexical reads unavailable",
  );
  await assert.rejects(
    () => recoverInterruptedResearchResourceRestore({ root: targetResources }),
    /resubmit the backup archive/,
    "a crash before authority lands remains fail-closed",
  );

  await assert.rejects(
    () => restoreBackupArchive(archive, "research restore passphrase", {
      reconcileResearch: async () => {
        throw new Error("simulated crash after authoritative restore");
      },
    }),
    /simulated crash after authoritative restore/,
  );
  assert.equal(
    JSON.parse(await readFile(researchResourceRestoreMarkerPath(targetResources), "utf8")).phase,
    "authority-ready",
  );
  let restartChild: ChildProcessWithoutNullStreams | null = null;
  let restartChildDone: Promise<void> | null = null;
  const restarted = await recoverInterruptedResearchResourceRestore({
    root: targetResources,
    failpoint: async (phase) => {
      if (phase !== "projection-reconciled" || restartChild) return;
      restartChild = spawn(process.execPath, [
        "--require", "./scripts/css-source-contract-hook.cjs",
        "--experimental-strip-types",
        "--import", "./scripts/test-alias-register.mjs",
        "src/lib/server/research-resource-restore-lock-child.ts",
        targetResources,
      ], { cwd: process.cwd(), stdio: ["pipe", "pipe", "pipe"] });
      await waitForLine(restartChild, "STARTED");
      restartChildDone = waitForLine(restartChild, "DONE");
      assert.equal(await Promise.race([
        restartChildDone.then(() => true),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 200)),
      ]), false, "startup recovery owns one lease across every repair phase");
    },
  });
  assert.equal(restarted?.lexicalRebuilt, true);
  await restartChildDone;
  await assert.rejects(() => lstat(researchResourceRestoreMarkerPath(targetResources)), /ENOENT/);

  let child: ChildProcessWithoutNullStreams | null = null;
  let childDone: Promise<void> | null = null;
  const restored = await restoreBackupArchive(archive, "research restore passphrase", {
    researchFailpoint: async () => {
      child = spawn(process.execPath, [
        "--require", "./scripts/css-source-contract-hook.cjs",
        "--experimental-strip-types",
        "--import", "./scripts/test-alias-register.mjs",
        "src/lib/server/research-resource-restore-lock-child.ts",
        targetResources,
      ], { cwd: process.cwd(), stdio: ["pipe", "pipe", "pipe"] });
      await waitForLine(child, "STARTED");
      childDone = waitForLine(child, "DONE");
      const raced = await Promise.race([
        childDone.then(() => true),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 200)),
      ]);
      assert.equal(raced, false, "cross-process mutation waits for the restore maintenance lock");
    },
  });
  await childDone;
  assert.deepEqual(restored.researchRecovery, {
    projectionReconciled: true,
    tombstoneFencesRepaired: 0,
    jobsRecreated: 0,
    lexicalRebuilt: true,
  });
  const targetStore = createResearchResourceStore({ root: targetResources });
  const restoredManifests = await targetStore.listManifests();
  assert.equal(restoredManifests.length, 2);
  assert.ok(restoredManifests.some((row) => row.legacySavedLink?.id === "restore-link"));
  assert.ok(restoredManifests.some((row) => row.id === "post-restore-child"));
  await assert.rejects(() => lstat(path.join(targetResources, "manifests", "stale.json")), /ENOENT/);
  await assert.rejects(() => lstat(path.join(targetResources, "blobs", "sha256", "ff", "stale")), /ENOENT/);
  assert.ok((await lstat(path.join(targetResources, "index", "research-resources.sqlite"))).isFile());
} finally {
  if (originalCovenHome === undefined) delete process.env.COVEN_HOME;
  else process.env.COVEN_HOME = originalCovenHome;
  if (originalCaveHome === undefined) delete process.env.COVEN_CAVE_HOME;
  else process.env.COVEN_CAVE_HOME = originalCaveHome;
  await rm(parent, { recursive: true, force: true });
}

console.log("backup-research-resource-restore.test.ts: ok");
