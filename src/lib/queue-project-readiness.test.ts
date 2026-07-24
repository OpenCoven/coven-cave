// @ts-nocheck
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const tempDir = await mkdtemp(path.join(os.tmpdir(), "cave-queue-project-"));
const projectRoot = path.join(tempDir, "project");
const projectsPath = path.join(tempDir, "projects.json");
const queueProjectPath = path.join(tempDir, "queue-project.json");
const previousProjectsPath = process.env.CAVE_PROJECTS_PATH_OVERRIDE;
const previousQueuePath = process.env.CAVE_QUEUE_PROJECT_PATH_OVERRIDE;

process.env.CAVE_PROJECTS_PATH_OVERRIDE = projectsPath;
process.env.CAVE_QUEUE_PROJECT_PATH_OVERRIDE = queueProjectPath;

try {
  await mkdir(projectRoot);
  execFileSync("git", ["init", "-q"], { cwd: projectRoot });
  await writeFile(
    projectsPath,
    JSON.stringify({
      version: 1,
      projects: [{
        id: "queue-project",
        name: "Queue project",
        root: projectRoot,
        createdAt: "2026-07-23T00:00:00.000Z",
        updatedAt: "2026-07-23T00:00:00.000Z",
      }],
    }),
  );

  const {
    cachedQueueProjectReadiness,
    invalidateQueueProjectReadinessCache,
    queueProjectReadiness,
    selectQueueProject,
  } = await import("./queue-project-readiness.ts");

  assert.equal((await queueProjectReadiness()).code, "no-project", "Queue never falls back to the app cwd");
  assert.equal((await selectQueueProject("queue-project"))?.root, projectRoot, "selection persists a registered project");

  const unavailableWithoutWorkspace = await queueProjectReadiness({
    beadsProbe: async () => ({ ok: false, status: 503, error: "bd unavailable", stdout: "", stderr: "" }),
  });
  assert.equal(unavailableWithoutWorkspace.code, "beads-unavailable", "missing .beads does not promise Generate when bd is unavailable");
  assert.equal(unavailableWithoutWorkspace.canGenerate, false);

  const needsBeads = await queueProjectReadiness({
    beadsProbe: async () => ({ ok: true, stdout: "bd 0.1.0", stderr: "" }),
  });
  assert.equal(needsBeads.code, "needs-beads");
  assert.equal(needsBeads.canGenerate, true, "only a selected Git repository can offer Generate");
  assert.equal(needsBeads.project?.root, projectRoot, "the selected repository remains the command root");

  await mkdir(path.join(projectRoot, ".beads"));
  const unavailable = await queueProjectReadiness({
    beadsProbe: async () => ({ ok: false, status: 503, error: "bd unavailable", stdout: "", stderr: "" }),
  });
  assert.equal(unavailable.code, "beads-unavailable", "an unavailable bd CLI is not presented as a generatable workspace");
  assert.equal(unavailable.canGenerate, false);
  assert.match(unavailable.message, /Install or repair the bd CLI/);

  const partial = await queueProjectReadiness({
    beadsProbe: async () => ({ ok: false, status: 502, error: "workspace incomplete", stdout: "", stderr: "" }),
  });
  assert.equal(partial.code, "needs-beads", "a partial workspace remains repairable through Generate");
  assert.equal(partial.canGenerate, true);
  await rm(path.join(projectRoot, ".beads"), { recursive: true, force: true });
  await mkdir(path.join(projectRoot, ".beads"));
  const ready = await queueProjectReadiness({
    beadsProbe: async () => ({ ok: true, stdout: "[]", stderr: "" }),
  });
  assert.equal(ready.code, "ready");
  assert.equal(ready.ok, true);

  let probeCalls = 0;
  const cachedProbe = async () => {
    probeCalls += 1;
    return { ok: true, stdout: "[]", stderr: "" };
  };
  invalidateQueueProjectReadinessCache();
  await Promise.all([
    cachedQueueProjectReadiness({ beadsProbe: cachedProbe }),
    cachedQueueProjectReadiness({ beadsProbe: cachedProbe }),
  ]);
  await cachedQueueProjectReadiness({ beadsProbe: cachedProbe });
  assert.equal(probeCalls, 1, "concurrent onboarding heartbeats share one readiness probe inside the cache window");
  invalidateQueueProjectReadinessCache();
  await cachedQueueProjectReadiness({ beadsProbe: cachedProbe });
  assert.equal(probeCalls, 2, "selection or Generate invalidation refreshes readiness immediately");

  let releaseOldProbe!: (result: { ok: true; stdout: string; stderr: string }) => void;
  const oldProbe = new Promise<{ ok: true; stdout: string; stderr: string }>((resolve) => { releaseOldProbe = resolve; });
  invalidateQueueProjectReadinessCache();
  const staleA = cachedQueueProjectReadiness({ beadsProbe: async () => oldProbe });
  await writeFile(
    projectsPath,
    JSON.stringify({
      version: 1,
      projects: [
        { id: "queue-project", name: "Queue project", root: projectRoot, createdAt: "2026-07-23T00:00:00.000Z", updatedAt: "2026-07-23T00:00:00.000Z" },
        { id: "invalid-project", name: "Invalid project", root: path.join(tempDir, "missing"), createdAt: "2026-07-23T00:00:00.000Z", updatedAt: "2026-07-23T00:00:00.000Z" },
      ],
    }),
  );
  await selectQueueProject("invalid-project");
  releaseOldProbe({ ok: true, stdout: "[]", stderr: "" });
  await staleA;
  assert.equal(
    (await cachedQueueProjectReadiness({ beadsProbe: async () => ({ ok: true, stdout: "[]", stderr: "" }) })).code,
    "project-missing",
    "a superseded readiness probe cannot repopulate the cache for a new selection",
  );

  const nestedRoot = path.join(projectRoot, "nested");
  await mkdir(nestedRoot);
  await writeFile(
    projectsPath,
    JSON.stringify({
      version: 1,
      projects: [{
        id: "nested-project",
        name: "Nested project",
        root: nestedRoot,
        createdAt: "2026-07-23T00:00:00.000Z",
        updatedAt: "2026-07-23T00:00:00.000Z",
      }],
    }),
  );
  await selectQueueProject("nested-project");
  assert.equal(
    (await queueProjectReadiness()).code,
    "project-not-git-root",
    "a selected subdirectory never authorizes its Git parent",
  );

  await writeFile(
    projectsPath,
    JSON.stringify({
      version: 1,
      projects: [{
        id: "queue-project",
        name: "Stale project",
        root: "not-an-absolute-host-path",
        createdAt: "2026-07-23T00:00:00.000Z",
        updatedAt: "2026-07-23T00:00:00.000Z",
      }],
    }),
  );
  await selectQueueProject("queue-project");
  const stale = await queueProjectReadiness();
  assert.equal(stale.code, "project-missing", "a path from another host is remediated before invoking Git");
  assert.match(stale.message, /Choose a project again/);

  await writeFile(queueProjectPath, "{ not valid JSON", "utf8");
  assert.equal(
    (await queueProjectReadiness()).code,
    "project-storage-error",
    "a corrupt selection reports storage remediation instead of pretending no project was selected",
  );

  const route = await (await import("node:fs/promises")).readFile(
    new URL("../app/api/queue/readiness/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(route, /rejectNonLocalRequest/, "selection and generation are loopback-only");
  assert.match(route, /projectId is required/, "Generate is bound to an explicit project identity");
  assert.match(route, /withGenerationLock/, "Generate serializes initialization per repository");
  assert.match(route, /current\.ok && identityMatches/, "a matching concurrent Generate succeeds idempotently");

  const prBridgeRoute = await (await import("node:fs/promises")).readFile(
    new URL("../app/api/beads/prs/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(prBridgeRoute, /projectRoot is required/, "the PR bridge rejects anonymous Queue requests");
  assert.doesNotMatch(prBridgeRoute, /projectRoot\) \|\| process\.cwd\(\)/, "the PR bridge cannot use the app cwd as a project fallback");
} finally {
  if (previousProjectsPath === undefined) delete process.env.CAVE_PROJECTS_PATH_OVERRIDE;
  else process.env.CAVE_PROJECTS_PATH_OVERRIDE = previousProjectsPath;
  if (previousQueuePath === undefined) delete process.env.CAVE_QUEUE_PROJECT_PATH_OVERRIDE;
  else process.env.CAVE_QUEUE_PROJECT_PATH_OVERRIDE = previousQueuePath;
  await rm(tempDir, { recursive: true, force: true });
}

console.log("queue-project-readiness.test.ts: ok");
