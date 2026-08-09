// @ts-nocheck
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  chmod,
  mkdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { refreshCovenSpawnEnv } from "@/lib/coven-bin";

const scratchRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), ".scratch-beads-overview-route-test");
const temp = path.join(scratchRoot, `${process.pid}-${Date.now()}`);
const goodProjectA = path.join(temp, "project-good-a");
const goodProjectB = path.join(temp, "project-good-b");
const malformedProject = path.join(temp, "project-malformed");
const errorProject = path.join(temp, "project-error");
const missingWorkspaceProject = path.join(temp, "project-missing-workspace");
const unsafeWorkspaceProject = path.join(temp, "project-unsafe-workspace");
const unrelatedCwd = path.join(temp, "unrelated-cwd");
const fakeBin = path.join(temp, "bin");
const commandLog = path.join(temp, "commands.jsonl");
const projectsPath = path.join(temp, "projects.json");
const previous = {
  cwd: process.cwd(),
  path: process.env.PATH,
  projects: process.env.CAVE_PROJECTS_PATH_OVERRIDE,
  commandLog: process.env.CAVE_ROUTE_COMMAND_LOG,
  token: process.env.COVEN_CAVE_AUTH_TOKEN,
};

function localRequest(url: string, init?: RequestInit) {
  return new Request(url, {
    ...init,
    headers: { host: "127.0.0.1", ...(init?.headers ?? {}) },
  });
}

function encodeProjectRoot(projectRoot: string) {
  return encodeURIComponent(projectRoot);
}

async function writeScenario(
  projectRoot: string,
  scenarios: Record<string, { exitCode?: number; stdout?: string; stdoutPath?: string; stderr?: string }>,
  files: Record<string, string> = {},
) {
  await Promise.all([
    ...Object.entries(files).map(([name, contents]) => writeFile(path.join(projectRoot, name), contents)),
    writeFile(path.join(projectRoot, ".fake-bd-scenario.json"), JSON.stringify(scenarios, null, 2)),
  ]);
}

async function readCommands() {
  try {
    const raw = await readFile(commandLog, "utf8");
    return raw.trim() ? raw.trim().split("\n").map((line) => JSON.parse(line)) : [];
  } catch {
    return [];
  }
}

try {
  await Promise.all([
    mkdir(temp, { recursive: true }),
    mkdir(path.join(goodProjectA, ".beads"), { recursive: true }),
    mkdir(path.join(goodProjectB, ".beads"), { recursive: true }),
    mkdir(path.join(malformedProject, ".beads"), { recursive: true }),
    mkdir(path.join(errorProject, ".beads"), { recursive: true }),
    mkdir(unsafeWorkspaceProject, { recursive: true }),
    mkdir(missingWorkspaceProject, { recursive: true }),
    mkdir(unrelatedCwd, { recursive: true }),
    mkdir(fakeBin, { recursive: true }),
  ]);

  for (const repoRoot of [
    goodProjectA,
    goodProjectB,
    malformedProject,
    errorProject,
    missingWorkspaceProject,
    unsafeWorkspaceProject,
  ]) {
    execFileSync("git", ["init", "-q"], { cwd: repoRoot });
  }

  await symlink(path.join(goodProjectA, ".beads"), path.join(unsafeWorkspaceProject, ".beads"), "dir");

  const staleRows = Array.from({ length: 21 }, (_, index) => {
    const label = index === 19 ? [] : index === 20 ? ["surface:shared"] : ["surface:ios"];
    return {
      id: `stale-${index + 1}`,
      title: `Stale ${index + 1}`,
      status: "in_progress",
      priority: 2,
      updated_at: `2026-07-${String(21 - index).padStart(2, "0")}T12:00:00.000Z`,
      labels: label,
      description: `SECRET-DESCRIPTION-${index + 1}`,
      notes: [`SECRET-NOTE-${index + 1}`],
      comments: [{ body: `SECRET-COMMENT-${index + 1}` }],
      path: `/sensitive/path-${index + 1}`,
      stdout: `SECRET-STDOUT-${index + 1}`,
      stderr: `SECRET-STDERR-${index + 1}`,
    };
  });

  const allRows = [
    {
      id: "open-ready",
      title: "Open Ready",
      status: "open",
      priority: 1,
      updated_at: "2026-08-08T12:00:00.000Z",
      labels: ["surface:desktop"],
      description: "SECRET-DESCRIPTION-OPEN",
      notes: ["SECRET-NOTE-OPEN"],
      comments: [{ body: "SECRET-COMMENT-OPEN" }],
      path: "/sensitive/open",
    },
    {
      id: "open-missing",
      title: "Open Missing",
      status: "open",
      priority: 2,
      updated_at: "2026-08-07T12:00:00.000Z",
      labels: [],
      description: "SECRET-DESCRIPTION-MISSING",
    },
    ...staleRows,
    {
      id: "blocked-conflicting",
      title: "Blocked Conflicting",
      status: "blocked",
      priority: 3,
      updated_at: "2026-08-06T12:00:00.000Z",
      labels: ["surface:ios", "surface:desktop"],
      comments: [{ body: "SECRET-COMMENT-BLOCKED" }],
    },
    {
      id: "deferred-shared",
      title: "Deferred Shared",
      status: "deferred",
      priority: 4,
      updated_at: "2026-08-05T12:00:00.000Z",
      labels: ["surface:shared"],
      notes: ["SECRET-NOTE-DEFERRED"],
    },
    {
      id: "closed-row",
      title: "Closed Row",
      status: "closed",
      priority: 5,
      updated_at: "2026-08-04T12:00:00.000Z",
      labels: ["surface:desktop"],
      description: "SECRET-DESCRIPTION-CLOSED",
    },
  ];

  const readyRows = [
    {
      id: "open-ready",
      title: "Open Ready",
      status: "open",
      priority: 1,
      updated_at: "2026-08-08T12:00:00.000Z",
      labels: ["surface:desktop"],
      description: "SECRET-READY-DESCRIPTION",
    },
    {
      id: "stale-1",
      title: "Stale 1",
      status: "in_progress",
      priority: 2,
      updated_at: "2026-07-01T12:00:00.000Z",
      labels: ["surface:ios"],
      notes: ["SECRET-READY-NOTE"],
    },
  ];

  await Promise.all([
    writeScenario(
      goodProjectA,
      {
        "list --all --json": { stdoutPath: ".bd-list.json", stderr: "TOP-LEVEL-STDERR-LIST" },
        "ready --json": { stdoutPath: ".bd-ready.json", stderr: "TOP-LEVEL-STDERR-READY" },
      },
      {
        ".bd-list.json": `${JSON.stringify(allRows, null, 2)}\n`,
        ".bd-ready.json": `${JSON.stringify(readyRows, null, 2)}\n`,
      },
    ),
    writeScenario(
      goodProjectB,
      {
        "list --all --json": { stdout: '[{"id":"project-b-open","title":"Project B Open","status":"open","priority":1,"updated_at":"2026-08-08T12:00:00.000Z","labels":["surface:shared"]}]\n' },
        "ready --json": { stdout: "[]\n" },
      },
    ),
    writeScenario(
      malformedProject,
      {
        "list --all --json": { stdout: "not-json\n", stderr: "MALFORMED-STDERR" },
        "ready --json": { stdout: "[]\n" },
      },
    ),
    writeScenario(
      errorProject,
      {
        "list --all --json": { stdout: "[]\n" },
        "ready --json": { exitCode: 1, stdout: "[]\n", stderr: "VERY SECRET STDERR" },
      },
    ),
  ]);

  const fakeBd = `#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
const args = process.argv.slice(2);
const scenarioPath = path.join(process.cwd(), ".fake-bd-scenario.json");
const scenarios = JSON.parse(fs.readFileSync(scenarioPath, "utf8"));
const key = args.join(" ");
const response = scenarios[key];
fs.appendFileSync(process.env.CAVE_ROUTE_COMMAND_LOG, JSON.stringify({
  cwd: process.cwd(),
  beadsDir: process.env.BEADS_DIR || "",
  args,
}) + "\\n");
if (!response) {
  process.stderr.write("unhandled scenario");
  process.exit(97);
}
if (response.stdoutPath) process.stdout.write(fs.readFileSync(path.join(process.cwd(), response.stdoutPath), "utf8"));
else if (response.stdout) process.stdout.write(response.stdout);
if (response.stderr) process.stderr.write(response.stderr);
process.exit(response.exitCode || 0);
`;
  await writeFile(path.join(fakeBin, "bd"), fakeBd);
  await chmod(path.join(fakeBin, "bd"), 0o755);

  const canonicalGoodA = await realpath(goodProjectA);
  const canonicalGoodB = await realpath(goodProjectB);
  await writeFile(
    projectsPath,
    JSON.stringify({
      version: 1,
      projects: [
        { id: "good-a", name: "Good A", root: goodProjectA, createdAt: "2026-08-09T00:00:00.000Z", updatedAt: "2026-08-09T00:00:00.000Z" },
        { id: "good-b", name: "Good B", root: goodProjectB, createdAt: "2026-08-09T00:00:00.000Z", updatedAt: "2026-08-09T00:00:00.000Z" },
        { id: "malformed", name: "Malformed", root: malformedProject, createdAt: "2026-08-09T00:00:00.000Z", updatedAt: "2026-08-09T00:00:00.000Z" },
        { id: "error", name: "Error", root: errorProject, createdAt: "2026-08-09T00:00:00.000Z", updatedAt: "2026-08-09T00:00:00.000Z" },
        { id: "missing", name: "Missing", root: missingWorkspaceProject, createdAt: "2026-08-09T00:00:00.000Z", updatedAt: "2026-08-09T00:00:00.000Z" },
        { id: "unsafe", name: "Unsafe", root: unsafeWorkspaceProject, createdAt: "2026-08-09T00:00:00.000Z", updatedAt: "2026-08-09T00:00:00.000Z" },
      ],
    }),
  );

  process.env.PATH = `${fakeBin}${path.delimiter}${previous.path ?? ""}`;
  process.env.CAVE_PROJECTS_PATH_OVERRIDE = projectsPath;
  process.env.CAVE_ROUTE_COMMAND_LOG = commandLog;
  delete process.env.COVEN_CAVE_AUTH_TOKEN;
  refreshCovenSpawnEnv();
  process.chdir(unrelatedCwd);

  const route = await import("./route.ts");
  const source = await import("@/lib/server/beads-delivery-source.ts");

  source.__clearBeadsDeliveryOverviewCacheForTests();

  const goodResponse = await route.GET(
    localRequest(`http://127.0.0.1/api/beads/overview?projectRoot=${encodeProjectRoot(goodProjectA)}`),
  );
  assert.equal(goodResponse.status, 200);
  const goodJson = await goodResponse.json();
  assert.equal(goodJson.ok, true);
  assert.equal(goodJson.projectRoot, canonicalGoodA);
  assert.deepEqual(goodJson.overview.totals, {
    remaining: 25,
    ready: 2,
    open: 2,
    inProgress: 21,
    blocked: 1,
    deferred: 1,
  });
  assert.deepEqual(goodJson.overview.surfaceHygiene, {
    ios: 19,
    desktop: 1,
    shared: 2,
    missing: 2,
    conflicting: 1,
  });
  assert.equal(goodJson.overview.stale.oldest.length, 20);
  assert.equal(goodJson.overview.stale.oldest[0]?.id, "stale-21");
  assert.equal(goodJson.overview.stale.oldest.at(-1)?.id, "stale-2");
  for (const item of goodJson.overview.stale.oldest) {
    assert.deepEqual(Object.keys(item).sort(), ["id", "priority", "stale", "status", "title", "updatedAt"]);
  }
  const serializedOverview = JSON.stringify(goodJson);
  for (const redacted of [
    "SECRET-DESCRIPTION",
    "SECRET-NOTE",
    "SECRET-COMMENT",
    "/sensitive/",
    "TOP-LEVEL-STDERR",
    "SECRET-STDOUT",
    "SECRET-STDERR",
  ]) {
    assert.doesNotMatch(serializedOverview, new RegExp(redacted.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  let commands = await readCommands();
  assert.equal(commands.length, 2);
  assert.deepEqual(
    commands.map((command) => command.cwd),
    [canonicalGoodA, canonicalGoodA],
  );
  assert.deepEqual(
    commands.map((command) => command.beadsDir),
    [path.join(canonicalGoodA, ".beads"), path.join(canonicalGoodA, ".beads")],
  );
  assert.deepEqual(
    commands.map((command) => command.args.join(" ")).sort(),
    ["list --all --json", "ready --json"],
  );

  const cachedResponse = await route.GET(
    localRequest(`http://127.0.0.1/api/beads/overview?projectRoot=${encodeProjectRoot(goodProjectA)}`),
  );
  assert.equal(cachedResponse.status, 200);
  commands = await readCommands();
  assert.equal(commands.length, 2, "cached reads avoid duplicate bd commands within the TTL");

  const otherRootResponse = await route.GET(
    localRequest(`http://127.0.0.1/api/beads/overview?projectRoot=${encodeProjectRoot(goodProjectB)}`),
  );
  assert.equal(otherRootResponse.status, 200);
  assert.equal((await otherRootResponse.json()).projectRoot, canonicalGoodB);
  commands = await readCommands();
  assert.equal(commands.length, 4, "a second canonical repo root gets its own cache entry");

  source.__clearBeadsDeliveryOverviewCacheForTests();
  const afterResetResponse = await route.GET(
    localRequest(`http://127.0.0.1/api/beads/overview?projectRoot=${encodeProjectRoot(goodProjectA)}`),
  );
  assert.equal(afterResetResponse.status, 200);
  commands = await readCommands();
  assert.equal(commands.length, 6, "tests can deterministically reset the overview cache");

  const missingProjectRoot = await route.GET(localRequest("http://127.0.0.1/api/beads/overview"));
  assert.equal(missingProjectRoot.status, 400);
  assert.deepEqual(await missingProjectRoot.json(), { ok: false, error: "projectRoot is required" });

  const remoteRequest = await route.GET(
    new Request(`http://127.0.0.1/api/beads/overview?projectRoot=${encodeProjectRoot(goodProjectA)}`, {
      headers: { host: "example.test" },
    }),
  );
  assert.equal(remoteRequest.status, 403);

  const missingWorkspace = await route.GET(
    localRequest(`http://127.0.0.1/api/beads/overview?projectRoot=${encodeProjectRoot(missingWorkspaceProject)}`),
  );
  assert.equal(missingWorkspace.status, 422);
  assert.deepEqual(await missingWorkspace.json(), { ok: false, error: "not a Beads workspace" });

  const unsafeWorkspace = await route.GET(
    localRequest(`http://127.0.0.1/api/beads/overview?projectRoot=${encodeProjectRoot(unsafeWorkspaceProject)}`),
  );
  assert.equal(unsafeWorkspace.status, 422);
  assert.deepEqual(await unsafeWorkspace.json(), { ok: false, error: "unsafe Beads workspace" });

  source.__clearBeadsDeliveryOverviewCacheForTests();
  const malformed = await route.GET(
    localRequest(`http://127.0.0.1/api/beads/overview?projectRoot=${encodeProjectRoot(malformedProject)}`),
  );
  assert.equal(malformed.status, 502);
  assert.deepEqual(await malformed.json(), { ok: false, error: "Beads overview unavailable" });

  source.__clearBeadsDeliveryOverviewCacheForTests();
  const errored = await route.GET(
    localRequest(`http://127.0.0.1/api/beads/overview?projectRoot=${encodeProjectRoot(errorProject)}`),
  );
  assert.equal(errored.status, 502);
  assert.deepEqual(await errored.json(), { ok: false, error: "Beads overview unavailable" });
} finally {
  process.chdir(previous.cwd);
  if (previous.path === undefined) delete process.env.PATH;
  else process.env.PATH = previous.path;
  if (previous.projects === undefined) delete process.env.CAVE_PROJECTS_PATH_OVERRIDE;
  else process.env.CAVE_PROJECTS_PATH_OVERRIDE = previous.projects;
  if (previous.commandLog === undefined) delete process.env.CAVE_ROUTE_COMMAND_LOG;
  else process.env.CAVE_ROUTE_COMMAND_LOG = previous.commandLog;
  if (previous.token === undefined) delete process.env.COVEN_CAVE_AUTH_TOKEN;
  else process.env.COVEN_CAVE_AUTH_TOKEN = previous.token;
  refreshCovenSpawnEnv();
  await rm(temp, { recursive: true, force: true });
  await rm(scratchRoot, { recursive: true, force: true });
}

console.log("beads overview route.test.ts: ok");
