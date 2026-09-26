// @ts-nocheck
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// realpath: readiness canonicalizes the Git toplevel, so a symlinked tmpdir
// (macOS /var → /private/var) must not skew root-equality assertions.
const tempDir = await realpath(await mkdtemp(path.join(os.tmpdir(), "cave-queue-project-")));
const projectRoot = path.join(tempDir, "project");
const nonGitRoot = path.join(tempDir, "not-a-git-project");
const projectsPath = path.join(tempDir, "projects.json");
const queueProjectPath = path.join(tempDir, "queue-project.json");
const previousProjectsPath = process.env.CAVE_PROJECTS_PATH_OVERRIDE;
const previousQueuePath = process.env.CAVE_QUEUE_PROJECT_PATH_OVERRIDE;

process.env.CAVE_PROJECTS_PATH_OVERRIDE = projectsPath;
process.env.CAVE_QUEUE_PROJECT_PATH_OVERRIDE = queueProjectPath;

try {
  await mkdir(projectRoot);
  await mkdir(nonGitRoot);
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
    takeQueueIssueSnapshot,
  } = await import("./queue-project-readiness.ts");
  const snapshot = { repository: "OpenCoven/example", ready: [], blocked: [], blockers: [] };
  const readyProbe = async () => ({ ok: true, snapshot });

  assert.equal((await queueProjectReadiness()).code, "no-project", "Queue never falls back to the app cwd");
  assert.equal((await selectQueueProject("queue-project"))?.root, projectRoot, "selection persists a registered project");

  await writeFile(
    projectsPath,
    JSON.stringify({
      version: 1,
      projects: [
        { id: "queue-project", name: "Queue project", root: projectRoot, createdAt: "2026-07-23T00:00:00.000Z", updatedAt: "2026-07-23T00:00:00.000Z" },
        { id: "non-git-project", name: "Not a Git project", root: nonGitRoot, createdAt: "2026-07-23T00:00:00.000Z", updatedAt: "2026-07-23T00:00:00.000Z" },
      ],
    }),
  );
  await selectQueueProject("non-git-project");
  const nonGit = await queueProjectReadiness();
  assert.equal(nonGit.code, "not-git-repository", "ordinary non-Git directories offer project reselection rather than a Git execution warning");
  await selectQueueProject("queue-project");

  const noGh = await queueProjectReadiness({
    issueProbe: async () => ({ ok: false, status: 503, error: "gh unavailable", stdout: "", stderr: "" }),
  });
  assert.equal(noGh.code, "github-unavailable", "a missing GitHub CLI is named as the remediation");
  assert.match(noGh.message, /gh auth login/);
  assert.equal(noGh.project?.root, projectRoot, "the selected repository stays in view while GitHub is unavailable");

  const noRemote = await queueProjectReadiness({
    issueProbe: async () => ({ ok: false, status: 502, error: "no git remotes found", stdout: "", stderr: "" }),
  });
  assert.equal(noRemote.code, "github-error", "a repository GitHub cannot read is an error, not a ready queue");
  assert.match(noRemote.message, /no git remotes found/);
  assert.match(noRemote.message, /GitHub remote/);

  const ready = await queueProjectReadiness({ issueProbe: readyProbe });
  assert.equal(ready.code, "ready");
  assert.equal(ready.ok, true);
  assert.equal("canGenerate" in ready, false, "GitHub Issues need no local workspace to generate");
  assert.deepEqual(takeQueueIssueSnapshot(projectRoot), snapshot, "the first list read reuses the issues readiness just read");
  assert.equal(takeQueueIssueSnapshot(projectRoot), null, "the reused snapshot is consumed once");

  let probeCalls = 0;
  const cachedProbe = async () => {
    probeCalls += 1;
    return { ok: true, snapshot };
  };
  invalidateQueueProjectReadinessCache();
  await Promise.all([
    cachedQueueProjectReadiness({ issueProbe: cachedProbe }),
    cachedQueueProjectReadiness({ issueProbe: cachedProbe }),
  ]);
  await cachedQueueProjectReadiness({ issueProbe: cachedProbe });
  assert.equal(probeCalls, 1, "concurrent onboarding heartbeats share one readiness probe inside the cache window");
  invalidateQueueProjectReadinessCache();
  await cachedQueueProjectReadiness({ issueProbe: cachedProbe });
  assert.equal(probeCalls, 2, "selection invalidation refreshes readiness immediately");

  let releaseOldProbe!: (result: unknown) => void;
  const oldProbe = new Promise((resolve) => { releaseOldProbe = resolve; });
  invalidateQueueProjectReadinessCache();
  const staleA = cachedQueueProjectReadiness({ issueProbe: async () => oldProbe });
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
  releaseOldProbe({ ok: true, snapshot });
  await staleA;
  assert.equal(
    (await cachedQueueProjectReadiness({ issueProbe: readyProbe })).code,
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
  assert.match(route, /rejectNonLocalRequest/, "selection is loopback-only");
  assert.match(route, /projectId is required/, "selection is bound to an explicit project identity");
  assert.doesNotMatch(route, /generate/i, "there is no Generate action to run");

  const readinessSource = await (await import("node:fs/promises")).readFile(
    new URL("./queue-project-readiness.ts", import.meta.url),
    "utf8",
  );
  assert.match(readinessSource, /env: caveToolSpawnEnv\(\)/, "Queue readiness finds Git through Cave's launch PATH");

  const prBridgeRoute = await (await import("node:fs/promises")).readFile(
    new URL("../app/api/queue/prs/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(prBridgeRoute, /projectRoot is required/, "the PR bridge rejects anonymous Queue requests");
  assert.doesNotMatch(prBridgeRoute, /projectRoot\) \|\| process\.cwd\(\)/, "the PR bridge cannot use the app cwd as a project fallback");
  assert.match(prBridgeRoute, /caveToolSpawnEnv\(\)/, "Queue PR reads use Cave's launch PATH for gh");
} finally {
  if (previousProjectsPath === undefined) delete process.env.CAVE_PROJECTS_PATH_OVERRIDE;
  else process.env.CAVE_PROJECTS_PATH_OVERRIDE = previousProjectsPath;
  if (previousQueuePath === undefined) delete process.env.CAVE_QUEUE_PROJECT_PATH_OVERRIDE;
  else process.env.CAVE_QUEUE_PROJECT_PATH_OVERRIDE = previousQueuePath;
  await rm(tempDir, { recursive: true, force: true });
}

console.log("queue-project-readiness.test.ts: ok");
