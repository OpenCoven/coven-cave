import assert from "node:assert/strict";
import {
  mkdir,
  readdir,
  rm,
  symlink,
} from "node:fs/promises";
import path from "node:path";
import { after, before, test } from "node:test";

import {
  researchMissionActionLocksRoot,
} from "./research-mission-store.ts";
import { withResearchMissionActionLock } from "./research-mission-lock.ts";

const originalMissionsRoot = process.env.COVEN_RESEARCH_MISSIONS_DIR;
const originalActionLocksRoot = process.env.COVEN_RESEARCH_ACTION_LOCKS_DIR;
const root = path.join(process.cwd(), `.research-mission-action-lock-${process.pid}`);
const missionsRoot = path.join(root, "missions");
const actionLocksRoot = path.join(root, "private", "action-locks");

before(async () => {
  await rm(root, { recursive: true, force: true });
  await mkdir(missionsRoot, { recursive: true });
  process.env.COVEN_RESEARCH_MISSIONS_DIR = missionsRoot;
  process.env.COVEN_RESEARCH_ACTION_LOCKS_DIR = actionLocksRoot;
});

after(async () => {
  if (originalMissionsRoot === undefined) delete process.env.COVEN_RESEARCH_MISSIONS_DIR;
  else process.env.COVEN_RESEARCH_MISSIONS_DIR = originalMissionsRoot;
  if (originalActionLocksRoot === undefined) delete process.env.COVEN_RESEARCH_ACTION_LOCKS_DIR;
  else process.env.COVEN_RESEARCH_ACTION_LOCKS_DIR = originalActionLocksRoot;
  await rm(root, { recursive: true, force: true });
});

test("mission action locks serialize overlapping callbacks in private per-mission intents", async () => {
  let releaseFirst!: () => void;
  const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
  let firstEntered!: () => void;
  const firstReady = new Promise<void>((resolve) => { firstEntered = resolve; });
  const order: string[] = [];

  const first = withResearchMissionActionLock("serialized-action", async () => {
    order.push("first-start");
    firstEntered();
    await firstGate;
    order.push("first-end");
  });
  await firstReady;
  assert.equal(researchMissionActionLocksRoot(), path.resolve(actionLocksRoot));
  assert.equal(
    (await readdir(path.join(actionLocksRoot, "serialized-action.locks"))).length,
    1,
  );

  const second = withResearchMissionActionLock("serialized-action", async () => {
    order.push("second");
  });
  await new Promise<void>((resolve) => setTimeout(resolve, 25));
  assert.deepEqual(order, ["first-start"]);

  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(order, ["first-start", "first-end", "second"]);
});

test("mission action lock root rejects relative, mission-writable, and symlinked overrides", async () => {
  try {
    process.env.COVEN_RESEARCH_ACTION_LOCKS_DIR = "relative/action-locks";
    assert.throws(() => researchMissionActionLocksRoot(), /must be absolute/i);

    process.env.COVEN_RESEARCH_ACTION_LOCKS_DIR = path.join(missionsRoot, "action-locks");
    assert.throws(() => researchMissionActionLocksRoot(), /outside mission workspaces/i);

    const linkedRoot = path.join(root, "linked-action-locks");
    await mkdir(path.join(missionsRoot, "linked-action-locks"), { recursive: true });
    await symlink(
      path.join(missionsRoot, "linked-action-locks"),
      linkedRoot,
      process.platform === "win32" ? "junction" : "dir",
    );
    process.env.COVEN_RESEARCH_ACTION_LOCKS_DIR = linkedRoot;
    await assert.rejects(
      () => withResearchMissionActionLock("symlinked-action", async () => {}),
      /must be a real directory|resolves inside mission workspaces/i,
    );
    await rm(linkedRoot, { force: true });
  } finally {
    process.env.COVEN_RESEARCH_ACTION_LOCKS_DIR = actionLocksRoot;
  }
});
