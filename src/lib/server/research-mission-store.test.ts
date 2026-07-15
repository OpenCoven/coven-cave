import assert from "node:assert/strict";
import { after, before } from "node:test";
import test from "node:test";
import {
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ResearchMission } from "../research-missions.ts";
import {
  MAX_RESEARCH_FILE_BYTES,
  createResearchMissionWorkspace,
  listResearchMissions,
  loadResearchMission,
  missionArtifactPath,
  readValidatedMissionFile,
  researchMissionWorkspacePath,
  saveResearchMission,
} from "./research-mission-store.ts";

const originalRoot = process.env.COVEN_RESEARCH_MISSIONS_DIR;
let root = "";

before(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "research-store-"));
  process.env.COVEN_RESEARCH_MISSIONS_DIR = root;
});

after(async () => {
  if (originalRoot === undefined) delete process.env.COVEN_RESEARCH_MISSIONS_DIR;
  else process.env.COVEN_RESEARCH_MISSIONS_DIR = originalRoot;
  await rm(root, { recursive: true, force: true });
});

function mission(id: string): ResearchMission {
  return {
    version: 1,
    id,
    familiarId: "sage",
    title: "Research mission",
    intent: "Compare two approaches",
    mode: "brief",
    modeSource: "user",
    deliverable: "brief",
    constraints: [],
    bounds: {
      wallClockMinutes: 20,
      maxIterations: 1,
      sourceTarget: 6,
      checkpointEvery: 1,
      stopWhenCostUnavailable: false,
    },
    status: "planning",
    createdAt: "2026-07-12T12:00:00.000Z",
    updatedAt: "2026-07-12T12:00:00.000Z",
    iterations: [],
    artifacts: [],
    sources: [],
  };
}

test("mission ids cannot escape the root", async () => {
  await assert.rejects(
    () => createResearchMissionWorkspace(mission("../escape")),
    /invalid mission id/i,
  );
  assert.throws(() => researchMissionWorkspacePath("UPPER"), /invalid mission id/i);
});

test("workspace creation initializes durable files and derives the list", async () => {
  const created = await createResearchMissionWorkspace(mission("initial-files"));
  assert.equal((await loadResearchMission(created.id))?.title, created.title);
  assert.equal(
    await readFile(path.join(researchMissionWorkspacePath(created.id), "findings.md"), "utf8"),
    "# Findings\n",
  );
  assert.deepEqual(
    JSON.parse(await readFile(path.join(researchMissionWorkspacePath(created.id), "sources.json"), "utf8")),
    [],
  );
  assert.ok((await listResearchMissions()).some((item) => item.id === created.id));
});

test("concurrent saves leave one complete JSON record", async () => {
  const created = await createResearchMissionWorkspace(mission("concurrent-save"));
  await Promise.all([
    saveResearchMission({ ...created, title: "first" }),
    saveResearchMission({ ...created, title: "second" }),
  ]);
  const loaded = await loadResearchMission(created.id);
  assert.ok(loaded?.title === "first" || loaded?.title === "second");
});

test("validated reads reject symlinks and oversized files", async () => {
  const created = await createResearchMissionWorkspace(mission("validated-read"));
  const linkedArtifact = missionArtifactPath(created.id, "primary.md");
  await symlink("/etc/hosts", linkedArtifact);
  await assert.rejects(
    () => readValidatedMissionFile(created.id, "artifacts/primary.md"),
    /symlink/i,
  );

  const largeArtifact = missionArtifactPath(created.id, "large.md");
  await writeFile(largeArtifact, "x".repeat(MAX_RESEARCH_FILE_BYTES + 1));
  await assert.rejects(
    () => readValidatedMissionFile(created.id, "artifacts/large.md"),
    /too large/i,
  );
});

test("validated reads remain contained in the mission workspace", async () => {
  const created = await createResearchMissionWorkspace(mission("contained-read"));
  assert.equal(
    await readValidatedMissionFile(created.id, "findings.md"),
    "# Findings\n",
  );
  await assert.rejects(
    () => readValidatedMissionFile(created.id, "../mission.json"),
    /outside mission workspace/i,
  );
});
