// @ts-nocheck
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  chmod,
  mkdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { refreshCovenSpawnEnv } from "@/lib/coven-bin";

const scratchRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), ".scratch-beads-route-test");
const temp = path.join(scratchRoot, `${process.pid}-${Date.now()}`);
const projectA = path.join(temp, "project-a");
const projectB = path.join(temp, "project-b");
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

async function writeScenario(
  projectRoot: string,
  scenarios: Record<string, { exitCode?: number; stdout?: string; stderr?: string }>,
) {
  await writeFile(path.join(projectRoot, ".fake-bd-scenario.json"), JSON.stringify(scenarios, null, 2));
}

async function readCommands() {
  try {
    const raw = await readFile(commandLog, "utf8");
    return raw.trim() ? raw.trim().split("\n").map((line) => JSON.parse(line)) : [];
  } catch {
    return [];
  }
}

async function clearCommands() {
  await writeFile(commandLog, "");
}

function countOverviewCommands(commands: Array<{ cwd: string; args: string[] }>, cwd: string) {
  return commands.filter((command) => {
    if (command.cwd !== cwd || command.command !== "bd") return false;
    const key = command.args.join(" ");
    return key === "list --all --json" || key === "ready --json";
  }).length;
}

async function readOverview(overviewRoute: { GET: (req: Request) => Promise<Response> }, projectRoot: string, canonicalRoot: string) {
  const response = await overviewRoute.GET(
    localRequest(`http://127.0.0.1/api/beads/overview?projectRoot=${encodeURIComponent(projectRoot)}`),
  );
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal((await response.json()).projectRoot, canonicalRoot);
}

try {
  await Promise.all([
    mkdir(temp, { recursive: true }),
    mkdir(path.join(projectA, ".beads"), { recursive: true }),
    mkdir(path.join(projectB, ".beads"), { recursive: true }),
    mkdir(unrelatedCwd, { recursive: true }),
    mkdir(fakeBin, { recursive: true }),
  ]);
  execFileSync("git", ["init", "-q"], { cwd: projectA });
  execFileSync("git", ["init", "-q"], { cwd: projectB });
  const [canonicalProjectA, canonicalProjectB] = await Promise.all([realpath(projectA), realpath(projectB)]);
  await writeFile(
    projectsPath,
    JSON.stringify({
      version: 1,
      projects: [
        { id: "project-a", name: "Project A", root: projectA, createdAt: "2026-07-24T00:00:00.000Z", updatedAt: "2026-07-24T00:00:00.000Z" },
        { id: "project-b", name: "Project B", root: projectB, createdAt: "2026-07-24T00:00:00.000Z", updatedAt: "2026-07-24T00:00:00.000Z" },
      ],
    }),
  );
  await Promise.all([
    writeScenario(projectA, {
      "ready --json": {
        stdout: '[{"id":"cave-shared","title":"Shared","status":"open","priority":1,"updated_at":"2026-08-09T00:00:00.000Z","labels":["surface:shared"]}]\n',
      },
      "show cave-shared --json": {
        stdout: '{"id":"cave-shared","title":"Shared","status":"open"}\n',
      },
      "list --all --json": {
        stdout: '[{"id":"cave-shared","title":"Shared","status":"open","priority":1,"updated_at":"2026-08-09T00:00:00.000Z","labels":["surface:shared"]}]\n',
      },
      "update cave-shared --claim --json": {
        stdout: '{"id":"cave-shared","status":"in_progress"}\n',
      },
      "update cave-command-failure --claim --json": {
        exitCode: 1,
        stderr: "claim failed",
      },
      "comments add cave-shared Verified in project A. --json": {
        stdout: '{"id":"cave-shared","comment":{"body":"Verified in project A."}}\n',
      },
      "close cave-shared --reason Completed --json": {
        stdout: '{"id":"cave-shared","status":"closed"}\n',
      },
      "create PR-created bead --json -d PR #7 --external-ref gh-7 --labels from-pr,surface:shared": {
        stdout: '{"id":"cave-test-pr"}\n',
      },
      "create Asana-created bead --json -d Asana task --external-ref https://app.asana.com/0/7 --labels asana,surface:shared": {
        stdout: '{"id":"cave-test-asana"}\n',
      },
    }),
    writeScenario(projectB, {
      "list --all --json": {
        stdout: '[{"id":"project-b-open","title":"Project B Open","status":"open","priority":1,"updated_at":"2026-08-09T00:00:00.000Z","labels":["surface:shared"]}]\n',
      },
      "ready --json": {
        stdout: "[]\n",
      },
    }),
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
  command: "bd",
  cwd: process.cwd(),
  beadsDir: process.env.BEADS_DIR || "",
  args,
}) + "\\n");
if (!response) {
  process.stderr.write("unhandled scenario");
  process.exit(97);
}
if (response.stdout) process.stdout.write(response.stdout);
if (response.stderr) process.stderr.write(response.stderr);
process.exit(response.exitCode || 0);
`;
  const fakeGh = `#!/bin/sh
printf '{"command":"gh","cwd":"%s","beadsDir":"%s","args":["%s"]}\\n' "$PWD" "$BEADS_DIR" "$*" >> "$CAVE_ROUTE_COMMAND_LOG"
printf '[]\\n'
`;
  await Promise.all([writeFile(path.join(fakeBin, "bd"), fakeBd), writeFile(path.join(fakeBin, "gh"), fakeGh)]);
  await Promise.all([chmod(path.join(fakeBin, "bd"), 0o755), chmod(path.join(fakeBin, "gh"), 0o755)]);
  process.env.PATH = `${fakeBin}${path.delimiter}${previous.path ?? ""}`;
  refreshCovenSpawnEnv();
  process.env.CAVE_PROJECTS_PATH_OVERRIDE = projectsPath;
  process.env.CAVE_ROUTE_COMMAND_LOG = commandLog;
  delete process.env.COVEN_CAVE_AUTH_TOKEN;
  process.chdir(unrelatedCwd);

  const beads = await import("./route.ts");
  const overviewRoute = await import("./overview/route.ts");
  const prs = await import("./prs/route.ts");
  const source = await import("@/lib/server/beads-delivery-source.ts");
  const root = encodeURIComponent(projectA);

  for (const url of [
    `http://127.0.0.1/api/beads?mode=ready&projectRoot=${root}`,
    `http://127.0.0.1/api/beads?mode=show&id=cave-shared&projectRoot=${root}`,
  ]) {
    const response = await beads.GET(localRequest(url));
    assert.equal(response.status, 200, await response.clone().text());
    assert.equal((await response.json()).projectRoot, canonicalProjectA);
  }
  const prResponse = await prs.GET(localRequest(`http://127.0.0.1/api/beads/prs?projectRoot=${root}`));
  assert.equal(prResponse.status, 200);
  assert.equal((await prResponse.json()).projectRoot, canonicalProjectA);

  const mutations = [
    { action: "claim", id: "cave-shared" },
    { action: "comment", id: "cave-shared", comment: "Verified in project A." },
    { action: "close", id: "cave-shared", reason: "Completed" },
    { action: "create", title: "PR-created bead", surface: "shared", description: "PR #7", externalRef: "gh-7", labels: [" from-pr ", "", "from-pr"] },
    { action: "create", title: "Asana-created bead", surface: "shared", description: "Asana task", externalRef: "https://app.asana.com/0/7", labels: ["asana"] },
  ];
  for (const body of mutations) {
    const response = await beads.POST(localRequest("http://127.0.0.1/api/beads", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...body, projectRoot: projectA }),
    }));
    assert.equal(response.status, 200, `${body.action} is scoped to selected project A`);
    assert.equal((await response.json()).projectRoot, canonicalProjectA);
  }

  for (const invalid of [
    { title: "Missing surface", description: "bad", labels: ["from-pr"] },
    { title: "Invalid surface", surface: "daemon", description: "bad", labels: ["from-pr"] },
    { title: "Platform label in labels", surface: "shared", description: "bad", labels: ["from-pr", "surface:shared"] },
    { title: "Non-string surface", surface: 1, description: "bad", labels: ["from-pr"] },
    { title: "Labels must be an array", surface: "shared", description: "bad", labels: "from-pr" },
    { title: "Labels must contain only strings", surface: "shared", description: "bad", labels: ["from-pr", 1] },
  ]) {
    const response = await beads.POST(localRequest("http://127.0.0.1/api/beads", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "create", ...invalid, projectRoot: projectA }),
    }));
    assert.equal(response.status, 400, `${invalid.title} should be rejected`);
  }

  let commands = await readCommands();
  assert.ok(commands.some((entry) => entry.command === "gh"), "PR bridge invokes gh through the selected repository");
  assert.ok(commands.filter((entry) => entry.command === "bd").length >= 7, "list, detail, and every Queue mutation invoke bd");
  for (const command of commands) {
    assert.equal(command.cwd, canonicalProjectA, `${command.command} never falls back to unrelated process.cwd() or project B`);
    if (command.command === "bd") {
      assert.equal(
        command.beadsDir,
        path.join(canonicalProjectA, ".beads"),
        "Beads mutations stay inside selected project A",
      );
    }
  }
  const bdCreateArgs = commands.filter((entry) => entry.command === "bd" && entry.args[0] === "create");
  assert.equal(bdCreateArgs.length, 2, "malformed create payloads must fail before invoking bd create");
  assert.ok(
    bdCreateArgs.some((entry) => entry.args.join(" ").includes("--labels from-pr,surface:shared")),
    "PR filing appends exactly one generated shared platform label",
  );
  assert.ok(
    bdCreateArgs.some((entry) => entry.args.join(" ").includes("--labels asana,surface:shared")),
    "Asana filing appends exactly one generated shared platform label",
  );

  const successInvalidations = [
    { action: "claim", id: "cave-shared" },
    { action: "comment", id: "cave-shared", comment: "Verified in project A." },
    { action: "close", id: "cave-shared", reason: "Completed" },
    { action: "create", title: "PR-created bead", surface: "shared", description: "PR #7", externalRef: "gh-7", labels: ["from-pr"] },
  ];
  for (const body of successInvalidations) {
    source.__clearBeadsDeliveryOverviewCacheForTests();
    await clearCommands();
    await readOverview(overviewRoute, projectA, canonicalProjectA);
    await readOverview(overviewRoute, projectA, canonicalProjectA);
    commands = await readCommands();
    assert.equal(countOverviewCommands(commands, canonicalProjectA), 2, `${body.action} starts from a warm overview cache`);

    const response = await beads.POST(localRequest("http://127.0.0.1/api/beads", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...body, projectRoot: projectA }),
    }));
    assert.equal(response.status, 200, `${body.action} succeeds before invalidating`);

    await readOverview(overviewRoute, projectA, canonicalProjectA);
    commands = await readCommands();
    assert.equal(countOverviewCommands(commands, canonicalProjectA), 4, `${body.action} invalidates the overview cache on success`);
  }

  source.__clearBeadsDeliveryOverviewCacheForTests();
  await clearCommands();
  await readOverview(overviewRoute, projectA, canonicalProjectA);
  const validationFailure = await beads.POST(localRequest("http://127.0.0.1/api/beads", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "create", title: "Missing surface", description: "bad", labels: ["from-pr"], projectRoot: projectA }),
  }));
  assert.equal(validationFailure.status, 400);
  await readOverview(overviewRoute, projectA, canonicalProjectA);
  commands = await readCommands();
  assert.equal(countOverviewCommands(commands, canonicalProjectA), 2, "validation failures keep the warm overview cache");

  source.__clearBeadsDeliveryOverviewCacheForTests();
  await clearCommands();
  await readOverview(overviewRoute, projectA, canonicalProjectA);
  const commandFailure = await beads.POST(localRequest("http://127.0.0.1/api/beads", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "claim", id: "cave-command-failure", projectRoot: projectA }),
  }));
  assert.equal(commandFailure.status, 502);
  assert.equal((await commandFailure.json()).ok, false);
  await readOverview(overviewRoute, projectA, canonicalProjectA);
  commands = await readCommands();
  assert.equal(countOverviewCommands(commands, canonicalProjectA), 2, "bd command failures keep the warm overview cache");

  source.__clearBeadsDeliveryOverviewCacheForTests();
  await clearCommands();
  await readOverview(overviewRoute, projectA, canonicalProjectA);
  await readOverview(overviewRoute, projectB, canonicalProjectB);
  commands = await readCommands();
  assert.equal(countOverviewCommands(commands, canonicalProjectA), 2);
  assert.equal(countOverviewCommands(commands, canonicalProjectB), 2);
} finally {
  process.chdir(previous.cwd);
  if (previous.path === undefined) delete process.env.PATH;
  else process.env.PATH = previous.path;
  refreshCovenSpawnEnv();
  if (previous.projects === undefined) delete process.env.CAVE_PROJECTS_PATH_OVERRIDE;
  else process.env.CAVE_PROJECTS_PATH_OVERRIDE = previous.projects;
  if (previous.commandLog === undefined) delete process.env.CAVE_ROUTE_COMMAND_LOG;
  else process.env.CAVE_ROUTE_COMMAND_LOG = previous.commandLog;
  if (previous.token === undefined) delete process.env.COVEN_CAVE_AUTH_TOKEN;
  else process.env.COVEN_CAVE_AUTH_TOKEN = previous.token;
  await rm(temp, { recursive: true, force: true });
  await rm(scratchRoot, { recursive: true, force: true });
}

console.log("beads route.test.ts: ok");
