import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { constants } from "node:fs";
import {
  chmod,
  link,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rm,
  symlink,
  unlink,
  writeFile,
  type FileHandle,
} from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import type { ResearchRunV1 } from "../research-protocol/research-run.ts";
import type { RunManifestV1 } from "../research-protocol/run-manifest.ts";
import {
  createResearchRunCompletionReceipt,
  serializeResearchRunCompletionReceipt,
  type ResearchRunCompletionReceiptV1,
} from "../research-run-authority-receipt.ts";
import {
  loadResearchRunCompletionReceipt,
  researchRunCompletionReceiptPath,
  saveResearchRunCompletionReceipt,
} from "./research-run-receipt-store.ts";
import { withProcessIntentLock } from "./process-intent-lock.ts";

const MANIFEST = JSON.parse(
  await readFile(
    new URL(
      "../../../schemas/research/v1/fixtures/valid/run-manifest-final-local.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as RunManifestV1;

const RUN: ResearchRunV1 = {
  schema: "opencoven.research-run/v1",
  id: MANIFEST.runId,
  context: {
    contextPackId: "ctx_local_01",
    contextPackDigest: "a".repeat(64),
    topicProposalId: "proposal_local_01",
  },
  acceptedTopic: {
    proposalId: "proposal_local_01",
    question: "How should a durable receipt identify its evidence?",
    editedByUser: false,
  },
  execution: {
    location: "local",
    modelExecution: "cave-device",
    modelBinding: {
      familiarId: "sage",
      selection: "pinned",
      model: "gpt-5.6-sol",
    },
    strategy: "single-agent",
  },
  privacy: {
    remoteQueries: false,
    remoteContent: false,
    artifactContentSync: false,
    retention: "7-days",
    allowMemoryPromotion: false,
  },
  bounds: {
    wallClockMinutes: 45,
    maxIterations: 4,
    sourceTarget: 8,
    checkpointEvery: 2,
    stopWhenCostUnavailable: true,
  },
  status: "completed",
  createdAt: "2026-08-16T19:59:00.000Z",
  updatedAt: "2026-08-16T20:06:00.000Z",
  nextEventSequence: 2,
  artifactManifest: MANIFEST,
};

const TEST_ARTIFACTS_ROOT = path.join(process.cwd(), ".test-artifacts");
const MAX_RECEIPT_RECORD_BYTES = 2 * 1024 * 1024;

function receipt(citationCount = 1): ResearchRunCompletionReceiptV1 {
  return createResearchRunCompletionReceipt(RUN, { citationCount });
}

async function spawnSave(
  value: ResearchRunCompletionReceiptV1,
  root: string,
): Promise<string> {
  const moduleUrl = pathToFileURL(
    path.join(process.cwd(), "src/lib/server/research-run-receipt-store.ts"),
  ).href;
  const child = spawn(process.execPath, [
    "--experimental-strip-types",
    "--input-type=module",
    "-e",
    `const { saveResearchRunCompletionReceipt } = await import(${JSON.stringify(moduleUrl)});
     try {
       await saveResearchRunCompletionReceipt(JSON.parse(process.argv[1]), process.argv[2]);
       process.stdout.write("saved");
     } catch (error) {
       process.stdout.write("rejected:" + (error instanceof Error ? error.message : String(error)));
     }`,
    JSON.stringify(value),
    root,
  ], {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
  child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
  const code = await new Promise<number | null>((resolve) => child.once("exit", resolve));
  assert.equal(code, 0, stderr);
  return stdout;
}

function spawnLoad(root: string): {
  child: ReturnType<typeof spawn>;
  outcome: Promise<string>;
} {
  const moduleUrl = pathToFileURL(
    path.join(process.cwd(), "src/lib/server/research-run-receipt-store.ts"),
  ).href;
  const child = spawn(process.execPath, [
    "--experimental-strip-types",
    "--input-type=module",
    "-e",
    `const { loadResearchRunCompletionReceipt } = await import(${JSON.stringify(moduleUrl)});
     try {
       const receipt = await loadResearchRunCompletionReceipt(process.argv[1], process.argv[2]);
       process.stdout.write(receipt ? "loaded" : "missing");
     } catch (error) {
       process.stdout.write("rejected:" + (error instanceof Error ? error.message : String(error)));
     }`,
    RUN.id,
    root,
  ], {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
  });
  const outcome = new Promise<string>((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code !== 0) reject(new Error(stderr || `load process exited ${code}`));
      else resolve(stdout);
    });
  });
  return { child, outcome };
}

test("receipt publication is immutable and idempotent under cross-process contention", async () => {
  await mkdir(TEST_ARTIFACTS_ROOT, { recursive: true });
  const root = await mkdtemp(path.join(TEST_ARTIFACTS_ROOT, "receipt-contention-"));
  try {
    const first = receipt(1);
    const second = receipt(2);
    const outcomes = await Promise.all([
      spawnSave(first, root),
      spawnSave(second, root),
    ]);
    assert.equal(outcomes.filter((outcome) => outcome === "saved").length, 1);
    assert.equal(
      outcomes.filter((outcome) => /already exists with different bytes/.test(outcome)).length,
      1,
    );

    const stored = await loadResearchRunCompletionReceipt(RUN.id, root);
    assert.ok(stored);
    const winner = stored.citationCount === 1 ? first : second;
    const loser = stored.citationCount === 1 ? second : first;
    assert.equal(
      await readFile(researchRunCompletionReceiptPath(RUN.id, root), "utf8"),
      serializeResearchRunCompletionReceipt(winner),
    );
    await saveResearchRunCompletionReceipt(winner, root);
    await assert.rejects(
      () => saveResearchRunCompletionReceipt(loser, root),
      /already exists with different bytes/,
    );
    assert.equal(
      await readFile(researchRunCompletionReceiptPath(RUN.id, root), "utf8"),
      serializeResearchRunCompletionReceipt(winner),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("receipt reads wait until hard-link publication has only one name", async () => {
  await mkdir(TEST_ARTIFACTS_ROOT, { recursive: true });
  const root = await mkdtemp(path.join(TEST_ARTIFACTS_ROOT, "receipt-read-publication-"));
  try {
    assert.equal(await loadResearchRunCompletionReceipt(RUN.id, root), null);
    const target = researchRunCompletionReceiptPath(RUN.id, root);
    const temporary = path.join(root, `.tmp-${process.pid}-${"a".repeat(24)}`);
    await writeFile(temporary, serializeResearchRunCompletionReceipt(receipt()), { mode: 0o600 });

    let reader: ReturnType<typeof spawnLoad> | undefined;
    await withProcessIntentLock(
      {
        intentsDirectory: path.join(root, ".locks", "intents"),
        label: "receipt publication test",
      },
      async () => {
        await link(temporary, target);
        reader = spawnLoad(root);
        await new Promise((resolve) => setTimeout(resolve, 200));
        assert.equal(reader.child.exitCode, null, "reader observed an in-progress publication");
        await unlink(temporary);
      },
    );

    assert.equal(await reader!.outcome, "loaded");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("receipt reads recover a stale hard-link publication after publisher crash", async () => {
  await mkdir(TEST_ARTIFACTS_ROOT, { recursive: true });
  const root = await mkdtemp(path.join(TEST_ARTIFACTS_ROOT, "receipt-crash-recovery-"));
  try {
    assert.equal(await loadResearchRunCompletionReceipt(RUN.id, root), null);
    const target = researchRunCompletionReceiptPath(RUN.id, root);
    const temporary = path.join(root, `.tmp-${process.pid}-${"b".repeat(24)}`);
    const expected = receipt();
    await writeFile(temporary, serializeResearchRunCompletionReceipt(expected), { mode: 0o600 });
    await link(temporary, target);
    assert.equal((await lstat(target)).nlink, 2);

    assert.deepEqual(await loadResearchRunCompletionReceipt(RUN.id, root), expected);
    await assert.rejects(() => lstat(temporary), { code: "ENOENT" });
    assert.equal((await lstat(target)).nlink, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("receipt publication refuses unsupported directory sync and retries durably", async () => {
  await mkdir(TEST_ARTIFACTS_ROOT, { recursive: true });
  const root = await mkdtemp(path.join(TEST_ARTIFACTS_ROOT, "receipt-directory-sync-"));
  const locksDir = path.join(root, ".locks", "intents");
  const probePath = path.join(root, ".sync-probe");
  await mkdir(locksDir, { recursive: true, mode: 0o700 });
  await writeFile(probePath, "", { mode: 0o600 });
  const probeHandle = await open(probePath, constants.O_RDONLY);
  const fileHandlePrototype = Object.getPrototypeOf(probeHandle) as {
    sync: (this: FileHandle) => Promise<void>;
  };
  const originalSync = fileHandlePrototype.sync;
  await probeHandle.close();
  await rm(probePath);

  try {
    let unsupportedAttempts = 0;
    fileHandlePrototype.sync = async function(this: FileHandle): Promise<void> {
      if ((await this.stat()).isDirectory()) {
        unsupportedAttempts += 1;
        const error = new Error("directory sync unsupported") as NodeJS.ErrnoException;
        error.code = "EINVAL";
        throw error;
      }
      await originalSync.call(this);
    };

    await assert.rejects(
      () => saveResearchRunCompletionReceipt(receipt(), root),
      (error: NodeJS.ErrnoException) => {
        assert.equal(error.code, "EINVAL");
        return true;
      },
    );
    assert.equal(unsupportedAttempts, 1);
    const target = researchRunCompletionReceiptPath(RUN.id, root);
    assert.equal((await lstat(target)).nlink, 1);
    assert.deepEqual(
      (await readdir(root)).filter((name) => name.startsWith(".tmp-")),
      [],
      "a failed directory sync must not strand the publication hard link",
    );

    let retryDirectorySyncs = 0;
    fileHandlePrototype.sync = async function(this: FileHandle): Promise<void> {
      if ((await this.stat()).isDirectory()) retryDirectorySyncs += 1;
      await originalSync.call(this);
    };
    await saveResearchRunCompletionReceipt(receipt(), root);
    assert.equal(retryDirectorySyncs, 1, "an idempotent retry must establish durability");
    assert.deepEqual(await loadResearchRunCompletionReceipt(RUN.id, root), receipt());
  } finally {
    fileHandlePrototype.sync = originalSync;
    await rm(root, { recursive: true, force: true });
  }
});

test("receipt store creates private directories and records", async () => {
  await mkdir(TEST_ARTIFACTS_ROOT, { recursive: true });
  const root = path.join(TEST_ARTIFACTS_ROOT, `receipt-modes-${process.pid}-${Date.now()}`);
  try {
    await saveResearchRunCompletionReceipt(receipt(), root);
    if (process.platform !== "win32") {
      assert.equal((await lstat(root)).mode & 0o777, 0o700);
      assert.equal(
        (await lstat(researchRunCompletionReceiptPath(RUN.id, root))).mode & 0o777,
        0o600,
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("receipt store rejects relative, symlinked, shared, and workspace-overlapping roots", async () => {
  await mkdir(TEST_ARTIFACTS_ROOT, { recursive: true });
  const parent = await mkdtemp(path.join(TEST_ARTIFACTS_ROOT, "receipt-roots-"));
  const realRoot = path.join(parent, "real");
  const linkedRoot = path.join(parent, "linked");
  const sharedRoot = path.join(parent, "shared");
  const missionsRoot = path.join(parent, "missions");
  const previousMissionsRoot = process.env.COVEN_RESEARCH_MISSIONS_DIR;
  try {
    await mkdir(realRoot, { mode: 0o700 });
    await symlink(realRoot, linkedRoot, "dir");
    await assert.rejects(
      () => saveResearchRunCompletionReceipt(receipt(), linkedRoot),
      /root.*symlink/i,
    );
    await assert.rejects(
      () => saveResearchRunCompletionReceipt(receipt(), "relative-receipts"),
      /must be absolute/,
    );

    if (process.platform !== "win32") {
      await mkdir(sharedRoot, { mode: 0o700 });
      await chmod(sharedRoot, 0o755);
      await assert.rejects(
        () => saveResearchRunCompletionReceipt(receipt(), sharedRoot),
        /root.*permissions must be 700/i,
      );
    }

    process.env.COVEN_RESEARCH_MISSIONS_DIR = missionsRoot;
    await assert.rejects(
      () => saveResearchRunCompletionReceipt(receipt(), path.join(missionsRoot, "receipts")),
      /outside mission workspaces/,
    );
    await assert.rejects(
      () => saveResearchRunCompletionReceipt(receipt(), parent),
      /outside mission workspaces/,
    );
  } finally {
    if (previousMissionsRoot === undefined) delete process.env.COVEN_RESEARCH_MISSIONS_DIR;
    else process.env.COVEN_RESEARCH_MISSIONS_DIR = previousMissionsRoot;
    await rm(parent, { recursive: true, force: true });
  }
});

test("receipt store rejects a symlink in a receipt-root ancestor", async () => {
  await mkdir(TEST_ARTIFACTS_ROOT, { recursive: true });
  const parent = await mkdtemp(path.join(TEST_ARTIFACTS_ROOT, "receipt-ancestor-"));
  const realParent = path.join(parent, "real");
  const linkedParent = path.join(parent, "linked");
  try {
    await mkdir(realParent, { mode: 0o700 });
    await symlink(realParent, linkedParent, "dir");
    await assert.rejects(
      () => saveResearchRunCompletionReceipt(receipt(), path.join(linkedParent, "receipts")),
      /store root.*symlink|symlink.*ancestor/i,
    );
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("receipt store rejects a symlink in a mission-root ancestor", async () => {
  await mkdir(TEST_ARTIFACTS_ROOT, { recursive: true });
  const parent = await mkdtemp(path.join(TEST_ARTIFACTS_ROOT, "mission-ancestor-"));
  const realParent = path.join(parent, "real");
  const linkedParent = path.join(parent, "linked");
  const previousMissionsRoot = process.env.COVEN_RESEARCH_MISSIONS_DIR;
  try {
    await mkdir(path.join(realParent, "missions"), { recursive: true, mode: 0o700 });
    await symlink(realParent, linkedParent, "dir");
    process.env.COVEN_RESEARCH_MISSIONS_DIR = path.join(linkedParent, "missions");
    await assert.rejects(
      () => saveResearchRunCompletionReceipt(
        receipt(),
        path.join(realParent, "missions", "receipts"),
      ),
      /mission root.*symlink|symlink.*ancestor/i,
    );
  } finally {
    if (previousMissionsRoot === undefined) delete process.env.COVEN_RESEARCH_MISSIONS_DIR;
    else process.env.COVEN_RESEARCH_MISSIONS_DIR = previousMissionsRoot;
    await rm(parent, { recursive: true, force: true });
  }
});

test("receipt reads reject symlinks, extra links, shared modes, and oversized records", async () => {
  await mkdir(TEST_ARTIFACTS_ROOT, { recursive: true });
  const parent = await mkdtemp(path.join(TEST_ARTIFACTS_ROOT, "receipt-reads-"));
  const cases = ["symlink", "hardlink", "shared", "oversized"];
  try {
    for (const name of cases) {
      const root = path.join(parent, name);
      await mkdir(root, { mode: 0o700 });
      const target = researchRunCompletionReceiptPath(RUN.id, root);
      if (name === "symlink") {
        const outside = path.join(parent, "outside.json");
        await writeFile(outside, serializeResearchRunCompletionReceipt(receipt()), { mode: 0o600 });
        await symlink(outside, target);
        await assert.rejects(
          () => loadResearchRunCompletionReceipt(RUN.id, root),
          /receipt.*symlink/i,
        );
      } else if (name === "hardlink") {
        const outside = path.join(parent, "hardlink-source.json");
        await writeFile(outside, serializeResearchRunCompletionReceipt(receipt()), { mode: 0o600 });
        await link(outside, target);
        await assert.rejects(
          () => loadResearchRunCompletionReceipt(RUN.id, root),
          /exactly one link/,
        );
      } else if (name === "shared") {
        await writeFile(target, serializeResearchRunCompletionReceipt(receipt()), { mode: 0o600 });
        if (process.platform !== "win32") {
          await chmod(target, 0o644);
          await assert.rejects(
            () => loadResearchRunCompletionReceipt(RUN.id, root),
            /receipt.*permissions must be 600/i,
          );
        }
      } else {
        await writeFile(target, Buffer.alloc(MAX_RECEIPT_RECORD_BYTES + 1), { mode: 0o600 });
        await assert.rejects(
          () => loadResearchRunCompletionReceipt(RUN.id, root),
          /exceeds its size limit/,
        );
      }
    }
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});
