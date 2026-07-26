// @ts-nocheck
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

// Runtime availability contract (#3856), exercised through the real route:
//
//   1. A runner that is missing from the exact spawn environment produces a
//      structured `runtime_missing` error WITHOUT spawning, the stream still
//      completes with a clean `done` event, and no fabricated assistant turn
//      (especially not the "installed but not authenticated" diagnosis) is
//      streamed or persisted.
//   2. A binary that passes the pre-spawn gate but fails at spawn (the race
//      fallback) marks the run errored before the empty-output diagnostic can
//      run, so the auth hint stays unreachable for launch failures too.
//
// Grok is the runner under test because its launch plan is the easiest to pin
// per scenario: GROK_BIN gives scenario 2 an absolute, existing-but-unrunnable
// binary, while scenario 1 relies on `grok` being absent — Grok Build is not
// distributed through the package managers that populate developer machines'
// well-known directories, and CI runners never carry it.
const home = await mkdtemp(path.join(homedir(), "cave-runtime-availability-"));
const bin = path.join(home, "bin");
const familiarWorkspace = path.join(home, "familiars", "opal");
await mkdir(bin, { recursive: true });
await mkdir(familiarWorkspace, { recursive: true });

const previousHome = process.env.COVEN_HOME;
const previousCaveHome = process.env.COVEN_CAVE_HOME;
const previousGrokBin = process.env.GROK_BIN;
const previousCovenBin = process.env.COVEN_BIN;
const previousPath = process.env.PATH;
const previousUserHome = process.env.HOME;
const previousShell = process.env.SHELL;
const previousAppData = process.env.APPDATA;
const previousNpmPrefix = process.env.npm_config_prefix;
process.env.COVEN_HOME = home;
process.env.COVEN_CAVE_HOME = path.join(home, "cave");
process.env.HOME = home;
process.env.SHELL = path.join(bin, "no-login-shell");
process.env.PATH = bin;
process.env.APPDATA = home;
process.env.npm_config_prefix = home;
delete process.env.GROK_BIN;
const fakeCoven = path.join(bin, process.platform === "win32" ? "coven.exe" : "coven");
await writeFile(fakeCoven, "not a real Coven executable\n", { mode: 0o755 });
process.env.COVEN_BIN = fakeCoven;

function restoreEnv(key, value) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

async function readSse(response) {
  assert.equal(response.status, 200, await response.clone().text());
  const body = await response.text();
  const events = body
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice("data: ".length)));
  return { body, events };
}

function assertNoFabricatedAssistantResponse(body, events) {
  assert.doesNotMatch(
    body,
    /installed but not authenticated/i,
    "a launch failure must never be diagnosed as an authentication problem",
  );
  assert.doesNotMatch(
    body,
    /produced no output/i,
    "a launch failure must not run the empty-output diagnostic",
  );
  assert.ok(
    !events.some((event) => event.kind === "assistant_chunk"),
    "a harness that never ran must not stream fabricated assistant text",
  );
}

const routeSource = await readFile(new URL("./route.ts", import.meta.url), "utf8");
assert.match(
  routeSource,
  /binding\.harness === "claude"\s*\? evaluateCovenBackedRuntimeAvailability\(\{[\s\S]*?runner: "claude",[\s\S]*?covenCommand: launch\.command,[\s\S]*?env: spawnEnv,[\s\S]*?unresolvedCovenWindowsShim:/,
  "Claude send preflight must use the shared Coven-plus-Claude contract with the exact later spawn environment",
);
assert.match(
  routeSource,
  /binding\.harness === "claude"[\s\S]{0,500}?stderrTail\.some[\s\S]*?RUNTIME_AVAILABILITY_ERROR_CODES\.claude_missing/,
  "a post-preflight Claude ENOENT reported by Coven must remain a launch failure rather than empty-output/auth copy",
);

try {
  const { refreshCovenBin, refreshCovenSpawnEnv } = await import("@/lib/coven-bin");
  refreshCovenBin();
  refreshCovenSpawnEnv();
  const { saveConfig } = await import("@/lib/cave-config");
  const { loadConversation } = await import("@/lib/cave-conversations");
  const { createProject } = await import("@/lib/cave-projects");
  const { grantProjectToFamiliar } = await import("@/lib/project-permissions");
  const { POST } = await import("./route.ts");
  const project = await createProject({ name: "Availability fixture", root: familiarWorkspace });
  await grantProjectToFamiliar({ familiarId: "opal", projectId: project.id, source: "human", access: "write" });

  // The fixture supplies only the fake outer Coven command. The composite
  // preflight must detect the missing inner `claude` before it can spawn.
  {
    await saveConfig({ familiars: { opal: { harness: "claude" } } });
    const response = await POST(new Request("http://localhost/api/chat/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ familiarId: "opal", prompt: "claude availability", projectRoot: familiarWorkspace }),
    }));
    const { body, events } = await readSse(response);

    const error = events.find((event) => event.kind === "error");
    assert.ok(error, "missing Claude produces a structured error before a model turn");
    assert.equal(error.code, "runtime_claude_missing");
    assert.match(error.message, /Claude Code CLI not found on PATH/);
    assertNoFabricatedAssistantResponse(body, events);

    const done = events.findLast((event) => event.kind === "done");
    assert.ok(done, "the unavailable Claude stream still completes");
    assert.equal(done.isError, true, "the unavailable Claude done event is errored");
    if (done.sessionId) {
      const conversation = await loadConversation(done.sessionId);
      assert.equal(
        (conversation?.turns ?? []).filter((turn) => turn.role === "assistant").length,
        0,
        "missing Claude never persists a fabricated assistant turn",
      );
    }
  }

  await saveConfig({ familiars: { opal: { harness: "grok" } } });

  // Scenario 1 — missing: no spawn, structured error, clean done, nothing
  // persisted as an assistant turn.
  {
    const response = await POST(new Request("http://localhost/api/chat/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ familiarId: "opal", prompt: "hello", projectRoot: familiarWorkspace }),
    }));
    const { body, events } = await readSse(response);

    const error = events.find((event) => event.kind === "error");
    assert.ok(error, "a missing runner produces a structured error event");
    assert.equal(
      error.code,
      "runtime_missing",
      "the pre-spawn gate reports the distinct missing code, not a spawn ENOENT",
    );
    assert.match(
      error.message,
      /Grok Build CLI not found on PATH/,
      "the missing error carries runner-specific install remediation",
    );
    assertNoFabricatedAssistantResponse(body, events);

    const done = events.findLast((event) => event.kind === "done");
    assert.ok(done, "the no-spawn path still completes the stream with a done event");
    assert.equal(done.isError, true, "the done event reports the errored outcome");
    if (done.sessionId) {
      const conversation = await loadConversation(done.sessionId);
      const assistantTurns = (conversation?.turns ?? []).filter(
        (turn) => turn.role === "assistant",
      );
      assert.equal(
        assistantTurns.length,
        0,
        "a never-launched turn must not persist a fabricated assistant response",
      );
    }
  }

  // Scenario 2 — post-spawn race fallback: the gate sees a real file, the
  // spawn itself fails (non-executable on POSIX, non-PE .exe on Windows).
  {
    const brokenName = process.platform === "win32" ? "grok-broken.exe" : "grok-broken";
    const broken = path.join(bin, brokenName);
    await writeFile(broken, "not an executable\n", { mode: 0o644 });
    process.env.GROK_BIN = broken;

    const response = await POST(new Request("http://localhost/api/chat/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ familiarId: "opal", prompt: "hello again", projectRoot: familiarWorkspace }),
    }));
    const { body, events } = await readSse(response);

    const error = events.find((event) => event.kind === "error");
    assert.ok(error, "a spawn-time launch failure surfaces a structured error event");
    assert.notEqual(
      error.code,
      "runtime_missing",
      "an existing-but-unrunnable binary is a launch failure, not a missing install",
    );
    assertNoFabricatedAssistantResponse(body, events);

    const failedStart = events.find(
      (event) => event.kind === "progress" && event.status === "error",
    );
    assert.ok(failedStart, "the failed launch is reported through the progress strip");
  }
} finally {
  restoreEnv("COVEN_HOME", previousHome);
  restoreEnv("COVEN_CAVE_HOME", previousCaveHome);
  restoreEnv("GROK_BIN", previousGrokBin);
  restoreEnv("COVEN_BIN", previousCovenBin);
  restoreEnv("PATH", previousPath);
  restoreEnv("HOME", previousUserHome);
  restoreEnv("SHELL", previousShell);
  restoreEnv("APPDATA", previousAppData);
  restoreEnv("npm_config_prefix", previousNpmPrefix);
  await rm(home, { recursive: true, force: true });
}

console.log("route-runtime-availability.integration.test.ts: ok");
