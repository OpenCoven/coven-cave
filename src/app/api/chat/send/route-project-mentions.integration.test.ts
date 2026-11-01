// @ts-nocheck
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

// Exercise the real project gate, filesystem resolver, prompt construction and
// persistence. Only the external Coven/Claude process is a controlled fixture.
// Using the familiar root, trusting the submitted root, or removing containment
// must fail these cases; the two roots intentionally contain the same filename.
const home = await realpath(await mkdtemp(path.join(homedir(), "cave-project-mentions-")));
const bin = path.join(home, "bin");
const workspace = path.join(home, "workspaces", "familiars", "sage");
const projectRoot = path.join(home, "project");
const otherRoot = path.join(home, "other-project");
const log = path.join(home, "deliveries.jsonl");
for (const dir of [bin, workspace, projectRoot, otherRoot]) await mkdir(dir, { recursive: true });
for (const [root, text] of [[workspace, "WRONG_WORKSPACE"], [projectRoot, "PROJECT_CONTENT"], [otherRoot, "OTHER_PROJECT"]]) {
  await writeFile(path.join(root, "shared.txt"), text);
}
await writeFile(path.join(projectRoot, "project-only.txt"), "PROJECT_ONLY");
await symlink(otherRoot, path.join(projectRoot, "escape"), process.platform === "win32" ? "junction" : "dir");
await symlink(projectRoot, path.join(home, "project-alias"), process.platform === "win32" ? "junction" : "dir");
const keys = ["HOME", "SHELL", "PATH", "Path", "COVEN_HOME", "COVEN_CAVE_HOME", "COVEN_BIN", "COVEN_WORKSPACES_ROOT"];
const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
process.env.HOME = home;
process.env.SHELL = path.join(home, "missing-shell");
process.env.COVEN_HOME = home;
process.env.COVEN_WORKSPACES_ROOT = path.join(home, "workspaces");
process.env.COVEN_CAVE_HOME = path.join(home, "cave");
process.env.PATH = bin + path.delimiter + process.env.PATH;
if (process.platform === "win32") delete process.env.Path;
const shim = `
const { appendFileSync, readFileSync } = require("node:fs");
const args = process.argv.slice(2);
if (args[0] === "run" && args[1] === "--help") {
  process.stdout.write("--model <model> --permission <permission> --add-dir <path> --write-scope <file>");
} else if (args[0] === "run" && args[1] === "claude") {
  const prompt = args[args.indexOf("--") + 1];
  const block = prompt.split("Referenced files (open with the Read tool):\\n")[1] || "";
  const files = block.split("\\n").filter(line => line.startsWith("- ")).map(line => line.slice(2));
  const receipt = { cwd: process.cwd(), files, contents: files.map(file => readFileSync(file, "utf8")) };
  appendFileSync(${JSON.stringify(log)}, JSON.stringify(receipt) + "\\n");
  const session_id = require("node:crypto").randomUUID();
  for (const frame of [
    { type: "system", subtype: "init", session_id },
    { type: "assistant", message: { content: [{ type: "text", text: JSON.stringify(receipt.contents) }] }, session_id },
    { type: "result", subtype: "success", is_error: false, session_id },
  ]) process.stdout.write(JSON.stringify(frame) + "\\n");
}
`;
const script = path.join(bin, "coven.cjs");
await writeFile(script, shim);
const executable = path.join(bin, process.platform === "win32" ? "coven.cmd" : "coven");
await writeFile(executable, process.platform === "win32"
  ? `"${process.execPath}" "%~dp0\\coven.cjs" %*\r\n`
  : `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`, { mode: 0o755 });
// Discovery sentinel only: the controlled Coven process above handles the turn.
await writeFile(path.join(bin, process.platform === "win32" ? "claude.exe" : "claude"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
process.env.COVEN_BIN = executable;

try {
  const { refreshCovenBin, refreshCovenSpawnEnv } = await import("@/lib/coven-bin");
  refreshCovenBin();
  refreshCovenSpawnEnv();
  const { saveConfig } = await import("@/lib/cave-config");
  const { createProject } = await import("@/lib/cave-projects");
  const { grantProjectToFamiliar } = await import("@/lib/project-permissions");
  const { loadConversation } = await import("@/lib/cave-conversations");
  const { POST } = await import("./route.ts");
  const { GET: listFiles } = await import("../../project/files/route.ts");
  const { NextRequest } = await import("next/server");
  await saveConfig({ familiars: { sage: { harness: "claude" } } });
  const project = await createProject({ name: "Mention fixture", root: projectRoot });
  await createProject({ name: "Denied project", root: otherRoot });
  await grantProjectToFamiliar({ familiarId: "sage", projectId: project.id, source: "human", access: "write" });
  execFileSync("git", ["init", "--quiet", projectRoot]);
  const indexResponse = await listFiles(new NextRequest(
    `http://localhost/api/project/files?root=${encodeURIComponent(projectRoot)}&familiarId=sage`,
  ));
  assert.equal(indexResponse.status, 200);
  const index = await indexResponse.json();
  assert.equal(index.root, projectRoot);
  assert.ok(index.files.includes("shared.txt") && index.files.includes("project-only.txt"), "the actual picker lists both selected project paths");
  const deliveries = async () => (await readFile(log, "utf8").catch(() => "")).trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
  const send = (body = {}) => POST(new Request("http://localhost/api/chat/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ familiarId: "sage", prompt: "Read the selected project files.", projectRoot, mentionedFiles: ["shared.txt", "project-only.txt"], ...body }),
  }));
  const cases = [
    { name: "picker root selects project files, never same-name familiar files", body: { mentionedFilesRoot: projectRoot }, files: ["shared.txt", "project-only.txt"], contents: ["PROJECT_CONTENT", "PROJECT_ONLY"] },
    { name: "legacy omitted picker root still uses authorized cwd", body: {}, files: ["shared.txt", "project-only.txt"], contents: ["PROJECT_CONTENT", "PROJECT_ONLY"] },
    { name: "canonical root alias matches", body: { mentionedFilesRoot: path.join(home, "project-alias") }, files: ["shared.txt", "project-only.txt"], contents: ["PROJECT_CONTENT", "PROJECT_ONLY"] },
    ...[workspace, otherRoot, path.join(home, "missing"), "project", "", null, 42].map(root => ({
      name: `mismatched or malformed root is refused (${JSON.stringify(root)})`, body: { mentionedFilesRoot: root }, files: [], contents: [],
    })),
    { name: "absolute, traversal and escaping symlinks cannot become mentions", body: { mentionedFilesRoot: projectRoot, mentionedFiles: [path.join(projectRoot, "shared.txt"), "../other-project/shared.txt", "..\\other-project\\shared.txt", "escape/shared.txt", "missing.txt", ".", "shared.txt"] }, files: ["shared.txt"], contents: ["PROJECT_CONTENT"] },
  ];
  for (const c of cases) {
    const before = (await deliveries()).length;
    const response = await send(c.body);
    assert.equal(response.status, 200, await response.clone().text());
    const events = (await response.text()).split("\n").filter(line => line.startsWith("data: ")).map(line => JSON.parse(line.slice(6)));
    assert.ok(!events.some(event => event.kind === "error"), JSON.stringify(events.filter(event => event.kind === "error")));
    const after = await deliveries();
    assert.equal(after.length, before + 1, `${c.name}: one controlled turn`);
    assert.deepEqual(after.at(-1), { cwd: projectRoot, files: c.files.map(file => path.join(projectRoot, file)), contents: c.contents }, c.name);
    const done = events.findLast(event => event.kind === "done");
    assert.ok(done?.sessionId, "completed project chat has a persisted session");
    const conversation = await loadConversation(done.sessionId);
    assert.equal(conversation.turns.findLast(turn => turn.role === "assistant").text, JSON.stringify(c.contents), `${c.name}: read result survives history`);
    console.log(`PASS ${c.name}`);
  }
  const before = (await deliveries()).length;
  const denied = await send({ projectRoot: otherRoot, mentionedFilesRoot: otherRoot });
  assert.equal(denied.status, 403);
  assert.equal((await denied.json()).code, "project_access_denied");
  assert.equal((await deliveries()).length, before, "a denied project never dispatches a harness");
  console.log("PASS project access denied before dispatch");
} finally {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await rm(home, { recursive: true, force: true });
}
