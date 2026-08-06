import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import {
  access,
  mkdir,
  mkdtemp,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { after, test } from "node:test";

import {
  openCheckpointStore,
  publishCheckpointUnit,
  recoverCheckpointStore,
} from "./checkpoint-store.ts";

const crashStage = process.env.CHECKPOINT_STORE_CRASH_STAGE;

function metadataIsValid(raw: string): boolean {
  try {
    return (JSON.parse(raw) as { version?: unknown }).version === 1;
  } catch {
    return false;
  }
}

if (crashStage) {
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
}
