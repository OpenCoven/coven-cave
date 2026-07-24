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

  const { queueProjectReadiness, selectQueueProject } = await import("./queue-project-readiness.ts");

  assert.equal((await queueProjectReadiness()).code, "no-project", "Queue never falls back to the app cwd");
  assert.equal((await selectQueueProject("queue-project"))?.root, projectRoot, "selection persists a registered project");

  const needsBeads = await queueProjectReadiness();
  assert.equal(needsBeads.code, "needs-beads");
  assert.equal(needsBeads.canGenerate, true, "only a selected Git repository can offer Generate");
  assert.equal(needsBeads.project?.root, projectRoot, "the selected repository remains the command root");

  await mkdir(path.join(projectRoot, ".beads"));
  const ready = await queueProjectReadiness();
  assert.equal(ready.code, "ready");
  assert.equal(ready.ok, true);

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
  const stale = await queueProjectReadiness();
  assert.equal(stale.code, "project-missing", "a path from another host is remediated before invoking Git");
  assert.match(stale.message, /Choose a project again/);

  const route = await (await import("node:fs/promises")).readFile(
    new URL("../app/api/queue/readiness/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(route, /rejectNonLocalRequest/, "selection and generation are loopback-only");
  assert.match(route, /runBdCommand\(readiness\.project\.root, path\.join\(readiness\.project\.root, "\.beads"\), \["init"\]\)/, "Generate runs only in the selected repository");
} finally {
  if (previousProjectsPath === undefined) delete process.env.CAVE_PROJECTS_PATH_OVERRIDE;
  else process.env.CAVE_PROJECTS_PATH_OVERRIDE = previousProjectsPath;
  if (previousQueuePath === undefined) delete process.env.CAVE_QUEUE_PROJECT_PATH_OVERRIDE;
  else process.env.CAVE_QUEUE_PROJECT_PATH_OVERRIDE = previousQueuePath;
  await rm(tempDir, { recursive: true, force: true });
}

console.log("queue-project-readiness.test.ts: ok");
