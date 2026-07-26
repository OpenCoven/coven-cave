// @ts-nocheck
import assert from "node:assert/strict";
import { createHook } from "node:async_hooks";
import childProcess from "node:child_process";
import { chmod, mkdtemp, mkdir, rm, unlink, writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
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
// Grok is the runner under test because GROK_BIN lets both scenarios share one
// deterministic absolute command: prime its resolver while the fixture
// exists, remove it for scenario 1, then recreate it as a launch-race fixture
// for scenario 2. Host PATH contents can never change either outcome.
const home = await mkdtemp(path.join(homedir(), "cave-runtime-availability-"));
const bin = path.join(home, "bin");
const familiarWorkspace = path.join(home, "familiars", "opal");
await mkdir(bin, { recursive: true });
await mkdir(familiarWorkspace, { recursive: true });
const pinnedGrok = path.join(
  bin,
  process.platform === "win32" ? "grok-fixture.exe" : "grok-fixture",
);
await writeFile(pinnedGrok, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
if (process.platform !== "win32") await chmod(pinnedGrok, 0o755);

const previousHome = process.env.COVEN_HOME;
const previousCaveHome = process.env.COVEN_CAVE_HOME;
const previousCovenBin = process.env.COVEN_BIN;
const previousGrokBin = process.env.GROK_BIN;
process.env.COVEN_HOME = home;
process.env.COVEN_CAVE_HOME = path.join(home, "cave");
process.env.GROK_BIN = pinnedGrok;

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

try {
  const { covenLaunchCommand, refreshCovenBin } = await import("@/lib/coven-bin");
  refreshCovenBin();
  const { grokBin } = await import("@/lib/grok-bin");
  assert.equal(grokBin(), pinnedGrok, "the test pins Grok discovery to its isolated override");
  await unlink(pinnedGrok);
  const { saveConfig } = await import("@/lib/cave-config");
  const { loadConversation } = await import("@/lib/cave-conversations");
  const { createProject } = await import("@/lib/cave-projects");
  const { grantProjectToFamiliar } = await import("@/lib/project-permissions");
  const {
    missingRunnerMessage,
    runtimeLaunchFailedMessage,
  } = await import("@/lib/runtime-availability");
  const { POST } = await import("./route.ts");
  const project = await createProject({ name: "Availability fixture", root: familiarWorkspace });
  await grantProjectToFamiliar({ familiarId: "opal", projectId: project.id, source: "human", access: "write" });

  // Scenario 0 — early generic preflight: COVEN_BIN is a real mode-0644 file
  // on POSIX and an intentionally unconvertible .cmd shim on Windows. Failed
  // child-process launches still create PROCESSWRAP resources, so this
  // observes every attempted capability spawn without monkey-patching Node
  // internals. The passive gate itself uses only synchronous filesystem
  // inspection and therefore creates none.
  {
    const blockedCoven = path.join(
      bin,
      process.platform === "win32" ? "coven-no-exec.cmd" : "coven-no-exec",
    );
    await writeFile(
      blockedCoven,
      process.platform === "win32" ? "@echo off\r\nexit /b 0\r\n" : "#!/bin/sh\nexit 0\n",
      { mode: 0o644 },
    );
    if (process.platform !== "win32") await chmod(blockedCoven, 0o644);
    process.env.COVEN_BIN = blockedCoven;
    refreshCovenBin();
    if (process.platform === "win32") {
      assert.equal(
        covenLaunchCommand().unresolvedWindowsShim,
        true,
        "the Windows fixture stays unconvertible so passive preflight, not cmd.exe, owns the failure",
      );
    }
    await saveConfig({ familiars: { opal: { harness: "codex" } } });

    let processAttempts = 0;
    const hook = createHook({
      init(_asyncId, type) {
        if (type === "PROCESSWRAP") processAttempts += 1;
      },
    });
    hook.enable();
    let body: string;
    let events: Array<Record<string, unknown>>;
    try {
      const response = await POST(new Request("http://localhost/api/chat/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          familiarId: "opal",
          prompt: "do not probe an unavailable runner",
          projectRoot: familiarWorkspace,
        }),
      }));
      ({ body, events } = await readSse(response));
    } finally {
      hook.disable();
    }

    assert.equal(
      processAttempts,
      0,
      "an unavailable Coven launch plan prevents model, permission, add-dir, and final runner subprocesses",
    );
    const error = events.find((event) => event.kind === "error");
    assert.equal(error?.code, "runtime_unlaunchable");
    assert.match(String(error?.message), /Coven CLI was found/);
    assertNoFabricatedAssistantResponse(body, events);
    const done = events.findLast((event) => event.kind === "done");
    assert.equal(done?.isError, true, "the early no-spawn path still completes as an error");
    if (typeof done?.sessionId === "string") {
      const conversation = await loadConversation(done.sessionId);
      assert.equal(
        (conversation?.turns ?? []).filter((turn) => turn.role === "assistant").length,
        0,
        "early preflight failure must not persist an assistant turn",
      );
    }
  }

  await saveConfig({ familiars: { opal: { harness: "grok" } } });

  // Scenario 1 — missing: the pinned command was removed before preflight, so
  // no spawn occurs regardless of any Grok installation on the host.
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

  // Scenario 2 — post-spawn race fallback: the gate sees an executable file,
  // then spawn fails because its interpreter is missing (or because the
  // Windows .exe fixture is plain text).
  {
    const brokenContents = process.platform === "win32"
      ? "not an executable\n"
      : `#!${path.join(home, "missing-interpreter")}\nexit 0\n`;
    await writeFile(pinnedGrok, brokenContents, { mode: 0o755 });
    if (process.platform !== "win32") await chmod(pinnedGrok, 0o755);

    const response = await POST(new Request("http://localhost/api/chat/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ familiarId: "opal", prompt: "hello again", projectRoot: familiarWorkspace }),
    }));
    const { body, events } = await readSse(response);

    const error = events.find((event) => event.kind === "error");
    assert.ok(error, "a spawn-time launch failure surfaces a structured error event");
    if (process.platform === "win32") {
      assert.equal(
        error.code,
        "runtime_launch_failed",
        "the invalid text .exe reaches Windows spawn and receives the normalized launch-failure code",
      );
      assert.equal(
        error.message,
        runtimeLaunchFailedMessage("grok"),
        "Windows spawn failure uses the shared value-free Grok launch-failure copy",
      );
    } else {
      assert.equal(
        error.code,
        "runtime_missing",
        "the missing shebang interpreter stays in the structured missing-runtime contract",
      );
      assert.equal(
        error.message,
        missingRunnerMessage("grok"),
        "POSIX ENOENT uses the shared missing-runner copy",
      );
    }
    assertNoFabricatedAssistantResponse(body, events);

    const failedStart = events.find(
      (event) => event.kind === "progress" && event.status === "error",
    );
    assert.ok(failedStart, "the failed launch is reported through the progress strip");
    assert.equal(
      failedStart.detail,
      error.message,
      "progress and SSE must share one normalized post-spawn launch message",
    );
    assert.doesNotMatch(
      String(failedStart.detail),
      new RegExp(home.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      "post-spawn diagnostics must never expose the runner path",
    );

    const done = events.findLast((event) => event.kind === "done");
    assert.equal(done?.isError, true, "the post-spawn ENOENT completes the stream as an error");
  }

  // Scenario 3 — Windows can throw synchronously for an invalid executable
  // instead of returning a child that emits error. It must use the same
  // structured, no-fabricated-response completion as an async launch race.
  {
    await writeFile(pinnedGrok, "present for synchronous spawn\n", { mode: 0o755 });
    if (process.platform !== "win32") await chmod(pinnedGrok, 0o755);
    const originalSpawn = childProcess.spawn;
    childProcess.spawn = (() => {
      throw Object.assign(new Error("synthetic synchronous spawn failure"), { code: "UNKNOWN" });
    }) as typeof childProcess.spawn;
    syncBuiltinESMExports();
    try {
      const response = await POST(new Request("http://localhost/api/chat/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ familiarId: "opal", prompt: "hello synchronous failure", projectRoot: familiarWorkspace }),
      }));
      const { body, events } = await readSse(response);
      const error = events.find((event) => event.kind === "error");
      assert.equal(error?.code, "runtime_launch_failed");
      assert.equal(error?.message, runtimeLaunchFailedMessage("grok"));
      assertNoFabricatedAssistantResponse(body, events);
      const done = events.findLast((event) => event.kind === "done");
      assert.equal(done?.isError, true, "a synchronous spawn failure completes the stream as an error");
    } finally {
      childProcess.spawn = originalSpawn;
      syncBuiltinESMExports();
    }
  }
} finally {
  process.env.COVEN_HOME = previousHome;
  process.env.COVEN_CAVE_HOME = previousCaveHome;
  if (previousCovenBin === undefined) delete process.env.COVEN_BIN;
  else process.env.COVEN_BIN = previousCovenBin;
  if (previousGrokBin === undefined) delete process.env.GROK_BIN;
  else process.env.GROK_BIN = previousGrokBin;
  await rm(home, { recursive: true, force: true });
}

console.log("route-runtime-availability.integration.test.ts: ok");
