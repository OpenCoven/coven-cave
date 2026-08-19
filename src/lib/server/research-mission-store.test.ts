import assert from "node:assert/strict";
import { after, before } from "node:test";
import test from "node:test";
import {
  mkdir,
  readFile,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import type { ResearchMission } from "../research-missions.ts";
import {
  MAX_RESEARCH_FILE_BYTES,
  RESEARCH_SESSION_OWNER_WRITE_GRANT_DIAGNOSTIC,
  ResearchFileIntegrityError,
  assertResearchSessionOwnerOutsideWriteRoots,
  clearResearchMissionSessionOwner,
  createResearchMissionWorkspace,
  isResearchFileIntegrityError,
  listResearchMissions,
  loadResearchMission,
  loadResearchMissionSessionOwner,
  missionArtifactPath,
  readValidatedMissionFile,
  recordResearchMissionSessionOwner,
  restoreResearchMissionSourceFile,
  researchMissionSessionOwnersRoot,
  researchMissionWorkspacePath,
  saveResearchMission,
  writeResearchMissionSourceFile,
} from "./research-mission-store.ts";

const originalRoot = process.env.COVEN_RESEARCH_MISSIONS_DIR;
const originalOwnersRoot = process.env.COVEN_RESEARCH_SESSION_OWNERS_DIR;
let root = "";
let ownerRoot = "";

before(async () => {
  root = path.join(process.cwd(), `.research-store-${process.pid}`);
  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });
  process.env.COVEN_RESEARCH_MISSIONS_DIR = path.join(root, "missions");
  ownerRoot = path.join(root, "private", "session-owners");
  process.env.COVEN_RESEARCH_SESSION_OWNERS_DIR = ownerRoot;
});

after(async () => {
  if (originalRoot === undefined) delete process.env.COVEN_RESEARCH_MISSIONS_DIR;
  else process.env.COVEN_RESEARCH_MISSIONS_DIR = originalRoot;
  if (originalOwnersRoot === undefined) delete process.env.COVEN_RESEARCH_SESSION_OWNERS_DIR;
  else process.env.COVEN_RESEARCH_SESSION_OWNERS_DIR = originalOwnersRoot;
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

test("private session owners are atomic, exact, and outside writable mission workspaces", async () => {
  const directOwner = {
    missionId: "owned-direct",
    iteration: 1,
    sessionId: "direct-session",
    ownerKind: "direct-copilot" as const,
    recordedAt: "2026-08-10T20:00:00.000Z",
  };
  await createResearchMissionWorkspace(mission(directOwner.missionId));
  await recordResearchMissionSessionOwner(directOwner);
  assert.deepEqual(await loadResearchMissionSessionOwner(directOwner.missionId), directOwner);
  assert.equal(
    researchMissionSessionOwnersRoot().startsWith(
      `${researchMissionWorkspacePath(directOwner.missionId)}${path.sep}`,
    ),
    false,
  );

  await assert.rejects(
    () => recordResearchMissionSessionOwner({ ...directOwner, sessionId: "replacement-session" }),
    /different active session owner/i,
  );
  await clearResearchMissionSessionOwner(directOwner);
  assert.equal(await loadResearchMissionSessionOwner(directOwner.missionId), null);

  const daemonOwner = {
    missionId: "owned-daemon",
    iteration: 2,
    sessionId: "daemon-session",
    ownerKind: "owner-local-daemon" as const,
    authority: { kind: "owner-local-daemon" as const, socketPath: "/tmp/coven-owner.sock" },
    recordedAt: "2026-08-10T20:01:00.000Z",
  };
  await recordResearchMissionSessionOwner(daemonOwner);
  assert.deepEqual(await loadResearchMissionSessionOwner(daemonOwner.missionId), daemonOwner);
  await assert.rejects(
    () => clearResearchMissionSessionOwner({ ...daemonOwner, sessionId: "wrong-session" }),
    /changed before it could be cleared/i,
  );
  await clearResearchMissionSessionOwner(daemonOwner);
});

test("private session-owner parsing fails closed on malformed or remote provenance", async () => {
  await assert.rejects(
    () => recordResearchMissionSessionOwner({
      missionId: "remote-owner",
      iteration: 1,
      sessionId: "session-1",
      ownerKind: "owner-local-daemon",
      authority: { kind: "owner-local-daemon", socketPath: "\\\\remote-host\\pipe\\coven" },
      recordedAt: "2026-08-10T20:00:00.000Z",
    }),
    /invalid Research session owner/i,
  );
  await mkdir(researchMissionSessionOwnersRoot(), { recursive: true });
  const malformedOwner = path.join(researchMissionSessionOwnersRoot(), "remote-owner.json");
  await writeFile(malformedOwner, "{not-json", "utf8");
  await assert.rejects(
    () => loadResearchMissionSessionOwner("remote-owner"),
    /ownership ledger is malformed/i,
  );
  await rm(malformedOwner, { force: true });
});

test("private session-owner root rejects relative and mission-writable overrides", () => {
  try {
    process.env.COVEN_RESEARCH_SESSION_OWNERS_DIR = "relative/session-owners";
    assert.throws(() => researchMissionSessionOwnersRoot(), /must be absolute/i);
    process.env.COVEN_RESEARCH_SESSION_OWNERS_DIR = path.join(
      process.env.COVEN_RESEARCH_MISSIONS_DIR!,
      "agent-writable-owners",
    );
    assert.throws(() => researchMissionSessionOwnersRoot(), /outside mission workspaces/i);
  } finally {
    process.env.COVEN_RESEARCH_SESSION_OWNERS_DIR = ownerRoot;
  }
});

test("Research write grants cannot contain or enter the private owner root", async () => {
  const broadRoot = path.dirname(path.dirname(ownerRoot));
  const nestedRoot = path.join(ownerRoot, "nested-project");
  await mkdir(nestedRoot, { recursive: true });
  await assert.rejects(
    () => assertResearchSessionOwnerOutsideWriteRoots([broadRoot]),
    (error: unknown) => (
      error instanceof Error && error.message === RESEARCH_SESSION_OWNER_WRITE_GRANT_DIAGNOSTIC
    ),
  );
  await assert.rejects(
    () => assertResearchSessionOwnerOutsideWriteRoots([nestedRoot]),
    (error: unknown) => (
      error instanceof Error && error.message === RESEARCH_SESSION_OWNER_WRITE_GRANT_DIAGNOSTIC
    ),
  );

  const safeRoot = path.join(root, "safe-project");
  await mkdir(safeRoot, { recursive: true });
  await assert.doesNotReject(
    () => assertResearchSessionOwnerOutsideWriteRoots([safeRoot]),
  );
});

test("private owner loads reject a symlinked root into mission-writable storage", async () => {
  const writableTarget = path.join(
    process.env.COVEN_RESEARCH_MISSIONS_DIR!,
    "agent-owner-root",
  );
  const linkedRoot = path.join(root, "linked-owner-root");
  await mkdir(writableTarget, { recursive: true });
  await symlink(
    writableTarget,
    linkedRoot,
    process.platform === "win32" ? "junction" : "dir",
  );
  try {
    process.env.COVEN_RESEARCH_SESSION_OWNERS_DIR = linkedRoot;
    await assert.rejects(
      () => loadResearchMissionSessionOwner("linked-owner"),
      /must be a real directory|resolves inside mission workspaces/i,
    );
  } finally {
    process.env.COVEN_RESEARCH_SESSION_OWNERS_DIR = ownerRoot;
    await rm(linkedRoot, { force: true });
  }
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

test("source-file rollback restores only its exact materialized content", async () => {
  const created = await createResearchMissionWorkspace(mission("conditional-source-rollback"));
  const fileName = "x-article-0123456789abcdef01234567.md";
  const target = path.join(researchMissionWorkspacePath(created.id), "source-files", fileName);

  const fresh = await writeResearchMissionSourceFile(created.id, fileName, "fresh materialization\n");
  await restoreResearchMissionSourceFile(created.id, fileName, fresh.previous, fresh.expected);
  await assert.rejects(() => readFile(target, "utf8"), { code: "ENOENT" });

  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, "prior contents\n", "utf8");
  const overwritten = await writeResearchMissionSourceFile(
    created.id,
    fileName,
    "replacement materialization\n",
  );
  await restoreResearchMissionSourceFile(
    created.id,
    fileName,
    overwritten.previous,
    overwritten.expected,
  );
  assert.equal(await readFile(target, "utf8"), "prior contents\n");

  const changed = await writeResearchMissionSourceFile(
    created.id,
    fileName,
    "materialized before external change\n",
  );
  await writeFile(target, "familiar changed this file\n", "utf8");
  await assert.rejects(
    () => restoreResearchMissionSourceFile(created.id, fileName, changed.previous, changed.expected),
    /changed after materialization.*rollback refused/i,
  );
  assert.equal(await readFile(target, "utf8"), "familiar changed this file\n");

  const missing = await writeResearchMissionSourceFile(
    created.id,
    fileName,
    "materialized before disappearance\n",
  );
  await unlink(target);
  await assert.rejects(
    () => restoreResearchMissionSourceFile(created.id, fileName, missing.previous, missing.expected),
    /missing after materialization.*rollback refused/i,
  );
});

test("containment failures throw the typed integrity error; a missing file does not (cave-v73d)", async () => {
  const created = await createResearchMissionWorkspace(mission("typed-integrity"));
  await symlink("/etc/hosts", missionArtifactPath(created.id, "primary.md"));

  // Symlink, escape, and oversized reads are all ResearchFileIntegrityError so
  // routes can map them to 4xx by type instead of brittle message matching.
  for (const relativePath of ["artifacts/primary.md", "../mission.json"]) {
    const error = await readValidatedMissionFile(created.id, relativePath).then(
      () => null,
      (caught) => caught,
    );
    assert.ok(isResearchFileIntegrityError(error), `${relativePath} is a typed integrity error`);
    assert.ok(error instanceof ResearchFileIntegrityError);
  }

  // A genuinely missing file carries Node's ENOENT and is NOT an integrity
  // failure — callers (the runner's readMissionFile) special-case it to null.
  const missing = await readValidatedMissionFile(created.id, "artifacts/nope.md").then(
    () => null,
    (caught) => caught,
  );
  assert.equal(isResearchFileIntegrityError(missing), false);
  assert.equal((missing as NodeJS.ErrnoException).code, "ENOENT");
});

test("loadResearchMission backfills standard artifact refs on legacy missions", async (t) => {
  const legacyRoot = path.join(root, "legacy-backfill");
  const previousRoot = process.env.COVEN_RESEARCH_MISSIONS_DIR;
  process.env.COVEN_RESEARCH_MISSIONS_DIR = legacyRoot;
  t.after(async () => {
    if (previousRoot === undefined) delete process.env.COVEN_RESEARCH_MISSIONS_DIR;
    else process.env.COVEN_RESEARCH_MISSIONS_DIR = previousRoot;
  });
  const legacy = {
    version: 1,
    id: "legacy-mission",
    familiarId: "sage",
    title: "Legacy",
    intent: "Legacy mission from before standard refs",
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
    status: "completed",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T01:00:00.000Z",
    iterations: [{ number: 1, status: "completed" }],
    artifacts: [{
      key: "primary",
      kind: "brief",
      title: "Legacy",
      relativePath: "artifacts/primary.md",
      iteration: 1,
      state: "working",
      updatedAt: "2026-07-01T01:00:00.000Z",
    }],
    sources: [],
  };
  await mkdir(path.join(legacyRoot, "legacy-mission"), { recursive: true });
  await writeFile(path.join(legacyRoot, "legacy-mission", "mission.json"), JSON.stringify(legacy));
  const loaded = await loadResearchMission("legacy-mission");
  assert.ok(loaded);
  assert.deepEqual(
    loaded.artifacts.map((artifact) => artifact.key),
    ["primary", "findings", "source-ledger", "research-log"],
  );
});

test("loadResearchMission repairs a completed mission downgraded by the missing-cost gate", async (t) => {
  const legacyRoot = await mkdtemp(path.join(os.tmpdir(), "research-store-cost-pause-"));
  const previousRoot = process.env.COVEN_RESEARCH_MISSIONS_DIR;
  process.env.COVEN_RESEARCH_MISSIONS_DIR = legacyRoot;
  t.after(async () => {
    if (previousRoot === undefined) delete process.env.COVEN_RESEARCH_MISSIONS_DIR;
    else process.env.COVEN_RESEARCH_MISSIONS_DIR = previousRoot;
    await rm(legacyRoot, { recursive: true, force: true });
  });
  const corrupted = {
    ...mission("cost-paused-complete"),
    status: "paused",
    finishedAt: "2026-08-15T04:51:00.510Z",
    lastError: "Cost unavailable; review before another iteration",
    bounds: {
      ...mission("cost-paused-complete").bounds,
      stopWhenCostUnavailable: true,
    },
    iterations: [{
      number: 1,
      status: "completed",
      finishedAt: "2026-08-15T04:51:00.510Z",
      decision: "complete",
      decisionReason: "Decision-ready result published",
    }],
  };
  await mkdir(path.join(legacyRoot, corrupted.id), { recursive: true });
  await writeFile(
    path.join(legacyRoot, corrupted.id, "mission.json"),
    JSON.stringify(corrupted),
  );
  const loaded = await loadResearchMission(corrupted.id);
  assert.equal(loaded?.status, "completed");
  assert.equal(loaded?.lastError, undefined);
  assert.equal(loaded?.finishedAt, corrupted.finishedAt);
});
