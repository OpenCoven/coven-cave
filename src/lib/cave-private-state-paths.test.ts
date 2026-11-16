// @ts-nocheck
import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { overlapsCavePrivateState, privateStateRelation } from "./cave-private-state.ts";

const scratch = await realpath(await mkdtemp(path.join(tmpdir(), "cave-private-paths-")));
const home = path.join(scratch, "cave");
const savedHome = process.env.COVEN_CAVE_HOME;
process.env.COVEN_CAVE_HOME = home;
try {
  await mkdir(path.join(home, "child"), { recursive: true });
  await test("a differently cased missing authority directory cannot gain Write", async (t) => {
    const sameVolumePath = await realpath(path.join(scratch, "CAVE")).catch(() => null);
    if (sameVolumePath !== home) return t.skip("case-sensitive volume");
    assert.equal(overlapsCavePrivateState(path.join(home, "CLAUDE-AUTHORITY")), true);
    assert.equal(overlapsCavePrivateState(path.join(home, "CLAUDE-AUTHORITY", "turn")), true);
  });
  await test("dangling targets resolve dot-dot after intermediate symlinks", async () => {
    await symlink(path.join(home, "child"), path.join(scratch, "pivot"), "dir");
    await symlink("pivot/../claude-authority", path.join(scratch, "project"));
    assert.equal(overlapsCavePrivateState(path.join(scratch, "project")), true);
  });
  await test("a dangling relative target starts at its canonical parent", async () => {
    await mkdir(path.join(scratch, "container"));
    await mkdir(path.join(scratch, "links"));
    await symlink(path.join(scratch, "container"), path.join(scratch, "links", "parent"), "dir");
    await symlink("../cave/claude-authority", path.join(scratch, "container", "project"));
    assert.equal(overlapsCavePrivateState(path.join(scratch, "links", "parent", "project")), true);
  });
  await test("an external authority target protects both the home entry and its target", async () => {
    const outside = path.join(scratch, "external-authority");
    await mkdir(outside);
    await symlink(outside, path.join(home, "claude-authority"), "dir");
    assert.equal(overlapsCavePrivateState(home), true);
    assert.equal(privateStateRelation(home), "contains", "the refusal describes the protected entry, not only its external target");
    assert.equal(overlapsCavePrivateState(outside), true);
    assert.equal(overlapsCavePrivateState(path.join(outside, "turn")), true);
    assert.equal(overlapsCavePrivateState(path.join(home, "research-missions")), false);
    assert.equal(overlapsCavePrivateState(path.join(scratch, "unrelated")), false);
  });
} finally {
  if (savedHome === undefined) delete process.env.COVEN_CAVE_HOME;
  else process.env.COVEN_CAVE_HOME = savedHome;
  await rm(scratch, { recursive: true, force: true });
}
