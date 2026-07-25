// @ts-nocheck
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

// This test runs the actual route against a temporary OpenCode command shim.
// It deliberately covers the boundary the source-shape test cannot: capability
// probing, selected argv, JSONL dispatch, SSE output, and persisted resume id.
// The route correctly rejects project roots outside the local home directory.
// Keep this fixture below that root on Linux as well as Windows so it reaches
// the OpenCode launch path instead of the project-scope guard.
const home = await mkdtemp(path.join(homedir(), "cave-opencode-route-"));
const bin = path.join(home, "bin");
const familiarWorkspace = path.join(home, "familiars", "opal");
await mkdir(bin, { recursive: true });
await mkdir(familiarWorkspace, { recursive: true });

const previousHome = process.env.COVEN_HOME;
const previousCaveHome = process.env.COVEN_CAVE_HOME;
const previousPath = process.env.PATH;
process.env.COVEN_HOME = home;
process.env.COVEN_CAVE_HOME = path.join(home, "cave");
process.env.PATH = `${bin}${path.delimiter}${previousPath ?? ""}`;

const executable = process.platform === "win32" ? "opencode.cmd" : "opencode";
const launcher = process.platform === "win32"
  ? [
      "@echo off",
      "if \"%~1\"==\"--version\" (echo 1.2.3& exit /b 0)",
      "if \"%~1\"==\"run\" if \"%~2\"==\"--help\" (",
      "  echo   --format ^<format^>  Output format: text, json",
      "  echo   --session ^<id^>     Session to continue",
      "  exit /b 0",
      ")",
      "if not \"%~1\"==\"run\" exit /b 9",
      "if not \"%~2\"==\"--format\" exit /b 9",
      "if not \"%~3\"==\"json\" exit /b 9",
      "if \"%~4\"==\"--\" exit /b 9",
      "echo {\"type\":\"text\",\"sessionID\":\"native_opencode_session\",\"part\":{\"type\":\"text\",\"text\":\"route reply\"}}",
      "exit /b 0",
    ].join("\r\n")
  : [
      "#!/bin/sh",
      "if [ \"$1\" = \"--version\" ]; then echo 1.2.3; exit 0; fi",
      "if [ \"$1\" = \"run\" ] && [ \"$2\" = \"--help\" ]; then",
      "  printf '%s\\n' '  --format <format>  Output format: text, json' '  --session <id>     Session to continue'",
      "  exit 0",
      "fi",
      "if [ \"$1\" != \"run\" ] || [ \"$2\" != \"--format\" ] || [ \"$3\" != \"json\" ] || [ \"$4\" = \"--\" ]; then exit 9; fi",
      "printf '%s\\n' '{\"type\":\"text\",\"sessionID\":\"native_opencode_session\",\"part\":{\"type\":\"text\",\"text\":\"route reply\"}}'",
    ].join("\n");
await writeFile(path.join(bin, executable), launcher, { mode: 0o755 });

try {
  // Other route modules can initialize Cave's augmented PATH before this
  // fixture installs its shim. Reset that process-local cache so the probe
  // and spawned turn resolve the same temporary OpenCode executable.
  const { refreshCovenBin } = await import("@/lib/coven-bin");
  refreshCovenBin();
  const { saveConfig } = await import("@/lib/cave-config");
  const { loadConversation } = await import("@/lib/cave-conversations");
  const { createProject } = await import("@/lib/cave-projects");
  const { grantProjectToFamiliar } = await import("@/lib/project-permissions");
  const { POST } = await import("./route.ts");
  await saveConfig({ familiars: { opal: { harness: "opencode" } } });
  const project = await createProject({ name: "Route fixture", root: familiarWorkspace });
  await grantProjectToFamiliar({ familiarId: "opal", projectId: project.id, source: "human", access: "write" });

  const response = await POST(new Request("http://localhost/api/chat/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ familiarId: "opal", prompt: "--format text", projectRoot: familiarWorkspace }),
  }));
  assert.equal(response.status, 200, await response.clone().text());
  const body = await response.text();
  assert.doesNotMatch(body, /empty response/i, "a legacy OpenCode help surface keeps the compatible positional prompt launch without an unprobed delimiter");
  assert.match(body, /"kind":"assistant_chunk","text":"route reply\\n"/, "the route streams text from the selected OpenCode JSON profile");
  const done = body
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice("data: ".length)))
    .findLast((event) => event.kind === "done");
  assert.ok(done, "the route completes the SSE stream");
  const sessionId = done.sessionId;
  assert.equal(typeof sessionId, "string");
  assert.notEqual(sessionId, "native_opencode_session", "Cave keeps its stable conversation id separate from OpenCode's native resume id");
  const conversation = await loadConversation(sessionId);
  assert.equal(conversation?.harnessSessionId, "native_opencode_session", "the route persists the native OpenCode session id separately from Cave's stable id");
} finally {
  if (previousHome === undefined) delete process.env.COVEN_HOME;
  else process.env.COVEN_HOME = previousHome;
  if (previousCaveHome === undefined) delete process.env.COVEN_CAVE_HOME;
  else process.env.COVEN_CAVE_HOME = previousCaveHome;
  if (previousPath === undefined) delete process.env.PATH;
  else process.env.PATH = previousPath;
  await rm(home, { recursive: true, force: true });
}

console.log("route-opencode.integration.test.ts: ok");
