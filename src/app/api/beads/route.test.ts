// @ts-nocheck
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const temp = await mkdtemp(path.join(os.tmpdir(), "cave-beads-route-"));
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

try {
  await Promise.all([
    mkdir(path.join(projectA, ".beads"), { recursive: true }),
    mkdir(path.join(projectB, ".beads"), { recursive: true }),
    mkdir(unrelatedCwd),
    mkdir(fakeBin),
  ]);
  execFileSync("git", ["init", "-q"], { cwd: projectA });
  execFileSync("git", ["init", "-q"], { cwd: projectB });
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
  const fakeCommand = `#!/bin/sh
printf '{"command":"%s","cwd":"%s","beadsDir":"%s","args":"%s"}\\n' "$(basename "$0")" "$PWD" "$BEADS_DIR" "$*" >> "$CAVE_ROUTE_COMMAND_LOG"
if [ "$(basename "$0")" = "gh" ]; then
  printf '[]\\n'
else
  printf '{"id":"cave-test"}\\n'
fi
`;
  await Promise.all([writeFile(path.join(fakeBin, "bd"), fakeCommand), writeFile(path.join(fakeBin, "gh"), fakeCommand)]);
  await Promise.all([chmod(path.join(fakeBin, "bd"), 0o755), chmod(path.join(fakeBin, "gh"), 0o755)]);
  process.env.PATH = `${fakeBin}${path.delimiter}${previous.path ?? ""}`;
  process.env.CAVE_PROJECTS_PATH_OVERRIDE = projectsPath;
  process.env.CAVE_ROUTE_COMMAND_LOG = commandLog;
  delete process.env.COVEN_CAVE_AUTH_TOKEN;
  process.chdir(unrelatedCwd);

  const beads = await import("./route.ts");
  const prs = await import("./prs/route.ts");
  const root = encodeURIComponent(projectA);

  for (const url of [
    `http://127.0.0.1/api/beads?mode=ready&projectRoot=${root}`,
    `http://127.0.0.1/api/beads?mode=show&id=cave-shared&projectRoot=${root}`,
  ]) {
    const response = await beads.GET(localRequest(url));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).projectRoot, projectA);
  }
  const prResponse = await prs.GET(localRequest(`http://127.0.0.1/api/beads/prs?projectRoot=${root}`));
  assert.equal(prResponse.status, 200);
  assert.equal((await prResponse.json()).projectRoot, projectA);

  const mutations = [
    { action: "claim", id: "cave-shared" },
    { action: "comment", id: "cave-shared", comment: "Verified in project A." },
    { action: "close", id: "cave-shared", reason: "Completed" },
    { action: "create", title: "PR-created bead", description: "PR #7", externalRef: "gh-7", labels: ["from-pr"] },
    { action: "create", title: "Asana-created bead", description: "Asana task", externalRef: "https://app.asana.com/0/7", labels: ["asana"] },
  ];
  for (const body of mutations) {
    const response = await beads.POST(localRequest("http://127.0.0.1/api/beads", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...body, projectRoot: projectA }),
    }));
    assert.equal(response.status, 200, `${body.action} is scoped to selected project A`);
    assert.equal((await response.json()).projectRoot, projectA);
  }

  const commands = (await readFile(commandLog, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.ok(commands.some((entry) => entry.command === "gh"), "PR bridge invokes gh through the selected repository");
  assert.ok(commands.filter((entry) => entry.command === "bd").length >= 7, "list, detail, and every Queue mutation invoke bd");
  for (const command of commands) {
    assert.equal(command.cwd, projectA, `${command.command} never falls back to unrelated process.cwd() or project B`);
    if (command.command === "bd") {
      assert.equal(command.beadsDir, path.join(projectA, ".beads"), "Beads mutations stay inside selected project A");
    }
  }
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
  await rm(temp, { recursive: true, force: true });
}

console.log("beads route.test.ts: ok");
