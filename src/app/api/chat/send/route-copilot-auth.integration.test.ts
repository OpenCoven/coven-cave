// @ts-nocheck
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

// A supported direct Copilot CLI can fail before its first JSONL frame. The
// route must recognize its sign-in stderr without exposing that stderr to Chat.
const home = await mkdtemp(path.join(homedir(), "cave-copilot-auth-"));
const bin = path.join(home, "bin");
const familiarWorkspace = path.join(home, "familiars", "opal");
await mkdir(bin, { recursive: true });
await mkdir(familiarWorkspace, { recursive: true });

const previous = Object.fromEntries(
  ["COVEN_HOME", "COVEN_CAVE_HOME", "HOME", "SHELL", "PATH", "Path"].map((key) => [key, process.env[key]]),
);
process.env.COVEN_HOME = home;
process.env.COVEN_CAVE_HOME = path.join(home, "cave");
process.env.HOME = home;
process.env.SHELL = path.join(home, "missing-shell");
process.env.PATH = bin;
if (process.platform === "win32") delete process.env.Path;

const shimScript = path.join(bin, "copilot.js");
await writeFile(shimScript, [
  "if (process.argv.includes('--version')) { console.log('1.0.70'); process.exit(0); }",
  "console.error('Not logged in. Use /login. secret SYNTHETIC_PRIVATE_DIAGNOSTIC_SENTINEL');",
  "process.exit(1);",
].join("\n"));
const copilotShim = path.join(bin, process.platform === "win32" ? "copilot.cmd" : "copilot");
await writeFile(
  copilotShim,
  process.platform === "win32"
    ? `@echo off\r\n"${process.execPath}" "${shimScript}" %*\r\n`
    : `#!/bin/sh\nexec "${process.execPath}" "${shimScript}" "$@"\n`,
  { mode: 0o755 },
);

try {
  const { saveConfig } = await import("@/lib/cave-config");
  const { createProject } = await import("@/lib/cave-projects");
  const { grantProjectToFamiliar } = await import("@/lib/project-permissions");
  const { POST } = await import("./route.ts");
  await saveConfig({ familiars: { opal: { harness: "copilot" } } });
  const project = await createProject({ name: "Copilot auth fixture", root: familiarWorkspace });
  await grantProjectToFamiliar({ familiarId: "opal", projectId: project.id, source: "human", access: "write" });

  const response = await POST(new Request("http://localhost/api/chat/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ familiarId: "opal", prompt: "needs sign-in", projectRoot: familiarWorkspace }),
  }));
  assert.equal(response.status, 200, await response.clone().text());
  const body = await response.text();
  const events = body.split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice("data: ".length)));
  const error = events.find((event) => event.kind === "error");
  assert.equal(error?.code, "harness_auth_required", JSON.stringify(events.slice(0, 8)));
  assert.match(error.message, /Copilot needs sign-in/);
  assert.doesNotMatch(body, /SYNTHETIC_PRIVATE_DIAGNOSTIC_SENTINEL|ghp_|secret|Not logged in/);
  assert.equal(events.findLast((event) => event.kind === "done")?.isError, true);
  console.log("route-copilot-auth.integration.test.ts OK");
} finally {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await rm(home, { recursive: true, force: true });
}
