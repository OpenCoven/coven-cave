// @ts-nocheck
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

// OpenCode preflight (#3862), exercised through the real route:
//
//   1. A prompt larger than Windows' command-line limit, with multiline and
//      shell-hostile data, survives preflight and launch over stdin. The gate
//      never consults it, and argv remains option-only.
//   2. A CLI that starts and exits non-zero keeps its existing error
//      classification: it is never reported as a missing install, and its
//      diagnostic turn is persisted (unlike launch failures, which persist
//      nothing).
//
// Two route scenarios are deliberately absent, both for the same reason:
// OpenCode launches by BARE NAME inside openCodeSpawnEnv()'s augmented PATH
// (Homebrew, ~/.local/bin, …), so on any machine with OpenCode installed a
// fixture cannot make it disappear (missing) and execvp's PATH search skips a
// planted non-executable candidate and finds the real install (EACCES race).
// The missing classification and remediation copy are unit-covered in
// src/lib/opencode-bin.test.ts; the route's no-spawn mechanics for
// runtime_missing and the post-gate spawn-failure race fallback are proven
// behaviorally in route-runtime-availability.integration.test.ts (grok pins
// its launch to an absolute path, so both failures are deterministic there),
// and OpenCode's value-free launch-failure copy on that shared fallback is
// pinned by harness-routing-opencode.test.ts.
const home = await mkdtemp(path.join(homedir(), "cave-opencode-preflight-"));
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

// Exceed CreateProcess' 32,767-character command-line ceiling before Cave adds
// identity and runtime context. Newlines, Unicode, quotes, and backslashes must
// remain byte-for-byte data rather than being reinterpreted by a launcher.
const hostilePrompt = `${"x".repeat(40_000)}
review 😀
quotes: "double" 'single'
slashes: C:\\Program Files\\OpenCode\\bin
shell: ; rm -rf ~ | $(evil) && echo "%PATH%" > pwned <'quote\``;
assert.ok(
  Buffer.byteLength(hostilePrompt, "utf8") > 40_000,
  "the fixture must stay above Windows' command-line limit",
);
const failPrompt = "FAIL_AUTH_EXIT";

// The shim is a Node script behind the same launcher shape npm installs use
// (shell wrapper on POSIX, parsed `.cmd` on Windows), so it can reflect the
// exact stdin and argv it received back through OpenCode's JSON event protocol
// without any shell re-parsing.
const shimScript = path.join(bin, "opencode-shim.mjs");
await writeFile(shimScript, [
  "const args = process.argv.slice(2);",
  "if (args[0] === \"--version\") { console.log(\"1.2.3\"); process.exit(0); }",
  "if (args[0] === \"run\" && args[1] === \"--help\") {",
  "  console.log(\"  --format <format>  Output format: text, json\");",
  "  console.log(\"  --session <id>     Session to continue\");",
  "  process.exit(0);",
  "}",
  "if (args[0] !== \"run\" || args[1] !== \"--format\" || args[2] !== \"json\") process.exit(9);",
  "let input = \"\";",
  "process.stdin.setEncoding(\"utf8\");",
  "for await (const chunk of process.stdin) input += chunk;",
  "if (input.includes(\"FAIL_AUTH_EXIT\")) {",
  "  console.error(\"opencode: authentication required for provider\");",
  "  process.exit(3);",
  "}",
  "console.log(JSON.stringify({ type: \"text\", sessionID: \"native_preflight_session\", part: { type: \"text\", text: `STDIN:${input}@ARGC=${args.length}@ARGS=${JSON.stringify(args)}@` } }));",
].join("\n"));

const executable = process.platform === "win32" ? "opencode.cmd" : "opencode";
const shimPath = path.join(bin, executable);
const launcher = process.platform === "win32"
  ? '"%dp0%\\node.exe" "%dp0%\\opencode-shim.mjs" %*\r\n'
  : "#!/bin/sh\nexec node \"$(dirname \"$0\")/opencode-shim.mjs\" \"$@\"";
await writeFile(shimPath, launcher, { mode: 0o755 });

async function readSse(response) {
  assert.equal(response.status, 200, await response.clone().text());
  const body = await response.text();
  const events = body
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice("data: ".length)));
  return { body, events };
}

try {
  // Other route modules can initialize Cave's augmented PATH before this
  // fixture installs its shim. Reset that process-local cache so the gate and
  // the spawned turn resolve the same temporary OpenCode executable.
  const { refreshCovenBin } = await import("@/lib/coven-bin");
  refreshCovenBin();
  const { saveConfig } = await import("@/lib/cave-config");
  const { loadConversation } = await import("@/lib/cave-conversations");
  const { createProject } = await import("@/lib/cave-projects");
  const { grantProjectToFamiliar } = await import("@/lib/project-permissions");
  const { POST } = await import("./route.ts");
  await saveConfig({ familiars: { opal: { harness: "opencode" } } });
  const project = await createProject({ name: "Preflight fixture", root: familiarWorkspace });
  await grantProjectToFamiliar({ familiarId: "opal", projectId: project.id, source: "human", access: "write" });

  const send = (prompt) => POST(new Request("http://localhost/api/chat/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ familiarId: "opal", prompt, projectRoot: familiarWorkspace }),
  }));

  // Scenario 1 — a large hostile prompt is stdin data through preflight AND
  // launch, while argv remains a small option-only command line.
  {
    const { events } = await readSse(await send(hostilePrompt));
    const chunks = events
      .filter((event) => event.kind === "assistant_chunk")
      .map((event) => event.text)
      .join("");
    assert.equal(
      chunks.includes(hostilePrompt),
      true,
      "the spawned CLI received the large multiline prompt verbatim over stdin",
    );
    assert.equal(
      chunks.includes("@ARGC=3@ARGS=[\"run\",\"--format\",\"json\"]@"),
      true,
      "the spawned CLI receives only OpenCode options in argv",
    );
    assert.ok(
      !events.some((event) => event.kind === "error"),
      "a ready runner with a hostile prompt launches without availability errors",
    );
  }

  // Scenario 2 — a CLI that STARTS and fails keeps its existing
  // classification: an auth/config failure is never a missing install, and
  // its diagnostic assistant turn is persisted.
  {
    const { body, events } = await readSse(await send(failPrompt));
    assert.ok(
      !events.some((event) => typeof event.code === "string" && event.code.startsWith("runtime_")),
      "a started CLI that exits non-zero is not reclassified as an availability failure",
    );
    assert.doesNotMatch(body, /not found on PATH/, "a started CLI failure never blames the install");
    assert.doesNotMatch(
      body,
      /installed but not authenticated/i,
      "an errored run must not use the completed-but-silent auth hint",
    );
    assert.match(
      body,
      /harness errored[\s\S]*?returned no text/,
      "a non-zero exit with no reply keeps the errored-run diagnostic",
    );
    const done = events.findLast((event) => event.kind === "done");
    assert.ok(done, "the errored run still completes the SSE stream");
    assert.equal(done.isError, true, "the done event reports the errored outcome");
    const conversation = await loadConversation(done.sessionId);
    const lastAssistant = (conversation?.turns ?? []).filter((turn) => turn.role === "assistant").at(-1);
    assert.match(
      lastAssistant?.text ?? "",
      /harness errored/,
      "a started CLI's failure diagnostic is persisted, unlike a launch failure",
    );
  }
} finally {
  if (previousHome === undefined) delete process.env.COVEN_HOME;
  else process.env.COVEN_HOME = previousHome;
  if (previousCaveHome === undefined) delete process.env.COVEN_CAVE_HOME;
  else process.env.COVEN_CAVE_HOME = previousCaveHome;
  if (previousPath === undefined) delete process.env.PATH;
  else process.env.PATH = previousPath;
  await rm(home, { recursive: true, force: true });
}

console.log("route-opencode-preflight.integration.test.ts: ok");
