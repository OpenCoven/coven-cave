import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { after, test } from "node:test";

import {
  checkpointDeleteQuarantinePath,
  openCheckpointStore,
  publishCheckpointUnit,
  recoverCheckpointStore,
  restoreCheckpointDirectoryQuarantineNoReplace,
} from "./checkpoint-store.ts";

const crashStage = process.env.CHECKPOINT_STORE_CRASH_STAGE;
const restoreCrashStage = process.env.CHECKPOINT_RESTORE_CRASH_STAGE;

function metadataIsValid(raw: string): boolean {
  try {
    return (JSON.parse(raw) as { version?: unknown }).version === 1;
  } catch {
    return false;
  }
}

if (restoreCrashStage) {
  const storePath = process.env.CHECKPOINT_STORE_CRASH_PATH!;
  const marker = process.env.CHECKPOINT_STORE_CRASH_MARKER!;
  const store = openCheckpointStore(storePath)!;
  const checkpointName = "2026-08-05T20-00-00-100Z.patch";
  const quarantine = path.join(
    storePath,
    process.env.CHECKPOINT_RESTORE_QUARANTINE!,
  );
  restoreCheckpointDirectoryQuarantineNoReplace(
    store,
    quarantine,
    path.join(storePath, checkpointName),
    metadataIsValid,
    {
      restorationStage: (stage) => {
        if (stage !== restoreCrashStage) return;
        writeFileSync(marker, "reached\n");
        process.kill(process.pid, "SIGKILL");
      },
    },
  );
} else if (crashStage) {
  const storePath = process.env.CHECKPOINT_STORE_CRASH_PATH!;
  const marker = process.env.CHECKPOINT_STORE_CRASH_MARKER!;
  const store = openCheckpointStore(storePath, { create: true })!;
  publishCheckpointUnit(
    store,
    "2026-08-05T20-00-00-000Z.patch",
    "crash-stage patch\n",
    JSON.stringify({
      version: 1,
      kind: "project-scope",
      projectRoot: path.dirname(storePath),
      projectPathspec: ".",
    }),
    {
      publicationStage: (stage) => {
        if (stage !== crashStage) return;
        writeFileSync(marker, "reached\n");
        process.kill(process.pid, "SIGKILL");
      },
    },
  );
} else {
  const temporary = await mkdtemp(
    path.join(process.cwd(), ".checkpoint-store-crash-test-"),
  );

  after(async () => {
    await rm(temporary, { recursive: true, force: true });
  });

  async function waitFor(file: string): Promise<void> {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      try {
        await access(file);
        return;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

    }
    throw new Error(`timed out waiting for ${file}`);
  }

  for (const stage of [
    "patch-file-synced",
    "metadata-file-synced",
    "draft-directory-synced",
    "checkpoint-renamed",
    "store-directory-synced",
  ]) {
    test(`checkpoint recovery handles a crash after ${stage}`, async () => {
      const caseRoot = path.join(temporary, stage);
      const gitDirectory = path.join(caseRoot, ".git");
      const storePath = path.join(gitDirectory, "coven-cave", "checkpoints");
      const marker = path.join(caseRoot, "stage-reached");
      await mkdir(gitDirectory, { recursive: true });
      const child = spawn(
        process.execPath,
        ["--experimental-strip-types", import.meta.filename],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            CHECKPOINT_STORE_CRASH_STAGE: stage,
            CHECKPOINT_STORE_CRASH_PATH: storePath,
            CHECKPOINT_STORE_CRASH_MARKER: marker,
          },
          stdio: "ignore",
        },
      );
      const exited = new Promise<void>((resolve, reject) => {
        child.once("error", reject);
        child.once("exit", () => resolve());
      });
      await waitFor(marker);
      await exited;

      const store = openCheckpointStore(storePath)!;
      recoverCheckpointStore(store, metadataIsValid);
      const entries = await readdir(storePath);
      assert.equal(
        entries.some((name) => name.startsWith(".publish-")),
        false,
        `${stage} leaves no publication draft after recovery`,
      );
      const published = entries.filter((name) => name.endsWith(".patch"));
      assert.equal(
        published.length,
        stage === "patch-file-synced" ? 0 : 1,
        `${stage} recovers exactly the complete durable unit`,
      );
      await writeFile(path.join(caseRoot, "recovered"), "ok\n");
    });
  }

  for (const stage of [
    "staged-patch-synced",
    "staged-metadata-synced",
    "staging-directory-synced",
    "destination-renamed",
    "store-directory-synced",
  ]) {
    test(`quarantine restoration recovers after ${stage}`, async () => {
      const caseRoot = path.join(temporary, `restore-${stage}`);
      const gitDirectory = path.join(caseRoot, ".git");
      const storePath = path.join(gitDirectory, "coven-cave", "checkpoints");
      const marker = path.join(caseRoot, "stage-reached");
      await mkdir(gitDirectory, { recursive: true });
      const store = openCheckpointStore(storePath, { create: true })!;
      const checkpointName = "2026-08-05T20-00-00-100Z.patch";
      const published = publishCheckpointUnit(
        store,
        checkpointName,
        "restored checkpoint\n",
        JSON.stringify({ version: 1 }),
      );
      const quarantine = checkpointDeleteQuarantinePath(
        store,
        checkpointName,
        "directory",
      );
      await rename(published, quarantine);
      const child = spawn(
        process.execPath,
        ["--experimental-strip-types", import.meta.filename],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            CHECKPOINT_RESTORE_CRASH_STAGE: stage,
            CHECKPOINT_STORE_CRASH_PATH: storePath,
            CHECKPOINT_STORE_CRASH_MARKER: marker,
            CHECKPOINT_RESTORE_QUARANTINE: path.basename(quarantine),
          },
          stdio: "ignore",
        },
      );
      const exited = new Promise<void>((resolve, reject) => {
        child.once("error", reject);
        child.once("exit", () => resolve());
      });
      await waitFor(marker);
      await exited;

      const reopened = openCheckpointStore(storePath)!;
      recoverCheckpointStore(reopened, metadataIsValid);
      const destination = path.join(storePath, checkpointName);
      assert.equal(
        await readFile(
          path.join(destination, "checkpoint.patch"),
          "utf8",
        ),
        "restored checkpoint\n",
      );
      const names = await readdir(storePath);
      assert.equal(
        names.some(
          (name) =>
            name.startsWith(".restore-directory-") ||
            name.startsWith(".delete-directory-"),
        ),
        false,
        `${stage} leaves no restoration staging or quarantine`,
      );
    });
  }
}
