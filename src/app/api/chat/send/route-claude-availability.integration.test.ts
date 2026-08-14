// @ts-nocheck
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

// Claude-specific launch coverage for cave-98c9s.3, through the real route.
// Claude rides `coven run claude --stream-json`, so its availability is the
// two-layer coven-backed contract: a missing INNER Claude and a missing OUTER
// Coven must produce distinct structured errors before any model command
// starts, and the post-preflight ENOENT race must map to the same Claude
// remediation instead of the generic empty-output/authentication copy.
const home = await mkdtemp(path.join(homedir(), "cave-claude-availability-"));
const covenBinDir = path.join(home, "coven-bin");
const claudeBinDir = path.join(home, "claude-bin");
const familiarWorkspace = path.join(home, "familiars", "sage");
const log = path.join(home, "coven-calls.jsonl");
await mkdir(covenBinDir, { recursive: true });
await mkdir(claudeBinDir, { recursive: true });
await mkdir(familiarWorkspace, { recursive: true });

const previousHome = process.env.COVEN_HOME;
const previousCaveHome = process.env.COVEN_CAVE_HOME;
const previousOsHome = process.env.HOME;
const previousShell = process.env.SHELL;
const previousCovenBin = process.env.COVEN_BIN;
const previousCovenTestLog = process.env.COVEN_TEST_LOG;
const previousCovenTestMode = process.env.COVEN_TEST_MODE;
const previousPath = process.env.PATH;
const previousPathCase = process.env.Path;
process.env.COVEN_HOME = home;
process.env.COVEN_CAVE_HOME = path.join(home, "cave");
process.env.COVEN_TEST_LOG = log;
// Cave deliberately augments the desktop-app PATH from HOME and the login
// shell. Redirect both so the machine's real `claude` install cannot defeat
// the missing case.
process.env.HOME = home;
process.env.SHELL = path.join(home, "missing-shell");
if (process.platform === "win32") delete process.env.Path;

const shim = [
  "const { appendFileSync } = require('node:fs');",
  "appendFileSync(process.env.COVEN_TEST_LOG, `${JSON.stringify(process.argv.slice(2))}\\n`);",
  "if (process.argv[2] === 'run' && process.argv[3] === 'claude') {",
  "  if (process.env.COVEN_TEST_MODE === 'race') {",
  "    process.stderr.write('spawn claude ENOENT\\n');",
  "    process.exit(1);",
  "  }",
  "  process.exit(1);",
  "}",
  "process.exit(0);",
].join("\n");
const shimScript = path.join(covenBinDir, "coven.js");
await writeFile(shimScript, shim, { mode: 0o755 });
let covenShim;
if (process.platform === "win32") {
  covenShim = path.join(covenBinDir, "coven.cmd");
  // covenLaunchCommand() resolves npm-style batch shims to `node <target>`.
  await writeFile(covenShim, '"%~dp0\\coven.js" %*\r\n');
} else {
  covenShim = path.join(covenBinDir, "coven");
  await writeFile(
    covenShim,
    `#!/bin/sh\nexec "${process.execPath}" "${shimScript}" "$@"\n`,
    { mode: 0o755 },
  );
}

// A launchable stand-in Claude for the cases that need the INNER layer ready.
const claudeExecutable = path.join(
  claudeBinDir,
  process.platform === "win32" ? "claude.exe" : "claude",
);
await writeFile(claudeExecutable, process.platform === "win32" ? "" : "#!/bin/sh\nexit 0\n", {
  mode: 0o755,
});

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
  assert.doesNotMatch(body, /installed but not authenticated/i);
  assert.doesNotMatch(body, /produced no output/i);
  assert.ok(!events.some((event) => event.kind === "assistant_chunk"));
}

async function covenCalls() {
  try {
    return (await readFile(log, "utf8"))
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

try {
  const { covenLaunchCommand, refreshCovenBin, refreshCovenSpawnEnv } = await import("@/lib/coven-bin");
  const { harnessSpawnEnv } = await import("@/lib/harness-spawn-env");
  const { evaluateCovenBackedRuntimeAvailability } = await import("@/lib/runtime-availability");
  const { saveConfig } = await import("@/lib/cave-config");
  const { loadConversation } = await import("@/lib/cave-conversations");
  const { createProject } = await import("@/lib/cave-projects");
  const { grantProjectToFamiliar } = await import("@/lib/project-permissions");
  const { POST } = await import("./route.ts");
  await saveConfig({ familiars: { sage: { harness: "claude" } } });
  const project = await createProject({ name: "Claude availability fixture", root: familiarWorkspace });
  await grantProjectToFamiliar({ familiarId: "sage", projectId: project.id, source: "human", access: "write" });

  const send = async (prompt) =>
    readSse(
      await POST(new Request("http://localhost/api/chat/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ familiarId: "sage", prompt, projectRoot: familiarWorkspace }),
      })),
    );

  // ── 1. Coven present, Claude out of the fixture env: route obeys the ──────
  //       evaluator's verdict either way.
  // Cave deliberately rebuilds the desktop spawn PATH from well-known install
  // dirs (/opt/homebrew/bin, /usr/local/bin), so hiding `claude` cannot be
  // guaranteed on a developer machine that has it installed there. Rather
  // than skip, assert AGREEMENT: compute the exact availability the route's
  // own evaluator sees, then require the route's observable behavior to match
  // it. On CI runners (no global claude) this exercises the missing branch —
  // blocked pre-spawn with the Claude-specific copy and NO model command; on
  // a dev machine where claude genuinely resolves, it proves criterion 1's
  // inverse: a present claude is never falsely blocked by preflight.
  process.env.COVEN_BIN = covenShim;
  process.env.PATH = covenBinDir; // fixture provides no claude of its own
  refreshCovenBin();
  refreshCovenSpawnEnv();
  {
    const launch = covenLaunchCommand();
    const verdict = evaluateCovenBackedRuntimeAvailability({
      runner: "claude",
      covenCommand: launch.command,
      env: harnessSpawnEnv("sage"),
      unresolvedCovenWindowsShim: launch.unresolvedWindowsShim === true,
    });
    const { body, events } = await send("hello");
    const error = events.find((event) => event.kind === "error");
    assert.ok(error, "an unready or fixture-failed launch produces a structured error event");
    assertNoFabricatedAssistantResponse(body, events);
    if (verdict.state !== "ready") {
      // The hermetic branch (all CI): blocked BEFORE any model turn.
      assert.equal(verdict.code, "runtime_claude_missing", JSON.stringify(verdict));
      assert.equal(error.code, "runtime_claude_missing", JSON.stringify(events.slice(0, 6)));
      assert.match(error.message, /Claude Code CLI not found on PATH/);
      assert.doesNotMatch(error.message, /Coven CLI not found/i, "the copy blames Claude, not Coven");
      assert.ok(
        !(await covenCalls()).some((args) => args[0] === "run" && args[1] === "claude"),
        "an unavailable Claude must never start `coven run claude`",
      );
      const done = events.findLast((event) => event.kind === "done");
      assert.ok(done, "the no-spawn path still completes the stream");
      assert.equal(done.isError, true);
      if (done.sessionId) {
        const conversation = await loadConversation(done.sessionId);
        assert.equal((conversation?.turns ?? []).filter((turn) => turn.role === "assistant").length, 0);
      }
    } else {
      // A machine where claude genuinely resolves in the spawn env: preflight
      // must NOT block; the fixture Coven then exits 1 and the failure stays
      // a truthful process failure, never a fabricated missing/auth verdict.
      assert.ok(
        (await covenCalls()).some((args) => args[0] === "run" && args[1] === "claude"),
        "a ready Claude launch reaches `coven run claude`",
      );
      assert.equal(error.code, "runtime_process_failed", JSON.stringify(events.slice(0, 6)));
    }
  }

  // ── 2. Coven absent: the OUTER layer fails with its own distinct code ──────
  delete process.env.COVEN_BIN;
  process.env.PATH = claudeBinDir; // claude present; coven nowhere
  refreshCovenBin();
  refreshCovenSpawnEnv();
  {
    const callsBefore = (await covenCalls()).length;
    const { body, events } = await send("hello without coven");
    const error = events.find((event) => event.kind === "error");
    assert.ok(error, "a missing outer Coven produces a structured error event");
    assert.equal(error.code, "runtime_coven_missing");
    assert.match(error.message, /Coven CLI not found on PATH/);
    assert.doesNotMatch(error.message, /Claude Code CLI/i, "the copy blames Coven, not Claude");
    assertNoFabricatedAssistantResponse(body, events);
    assert.ok(
      !(await covenCalls()).slice(callsBefore).some((args) => args[0] === "run" && args[1] === "claude"),
      "a missing Coven never reaches the fixture at all",
    );
  }

  // ── 3. ENOENT race after a PASSING preflight maps to the Claude state ──────
  // Both layers resolve at preflight; the started Coven then reports Claude's
  // spawn failed. The fallback must keep the Claude-specific remediation and
  // never let the race become generic empty-output/authentication copy.
  process.env.COVEN_BIN = covenShim;
  process.env.PATH = `${claudeBinDir}${path.delimiter}${covenBinDir}`;
  process.env.COVEN_TEST_MODE = "race";
  refreshCovenBin();
  refreshCovenSpawnEnv();
  {
    const raceCallsBefore = (await covenCalls()).length;
    const { body, events } = await send("hello race");
    const error = events.find((event) => event.kind === "error");
    assert.ok(error, "a post-preflight inner launch failure produces a structured error event");
    assert.equal(error.code, "runtime_claude_missing");
    assert.match(error.message, /Claude Code CLI not found on PATH/);
    assertNoFabricatedAssistantResponse(body, events);
    assert.ok(
      (await covenCalls()).slice(raceCallsBefore).some((args) => args[0] === "run" && args[1] === "claude"),
      "the race case DID pass preflight and start Coven",
    );
  }

  console.log("route-claude-availability.integration.test.ts OK");
} finally {
  process.env.COVEN_HOME = previousHome;
  process.env.COVEN_CAVE_HOME = previousCaveHome;
  process.env.HOME = previousOsHome;
  process.env.SHELL = previousShell;
  process.env.COVEN_TEST_LOG = previousCovenTestLog;
  if (previousCovenBin === undefined) delete process.env.COVEN_BIN;
  else process.env.COVEN_BIN = previousCovenBin;
  if (previousCovenTestMode === undefined) delete process.env.COVEN_TEST_MODE;
  else process.env.COVEN_TEST_MODE = previousCovenTestMode;
  process.env.PATH = previousPath;
  if (previousPathCase !== undefined) process.env.Path = previousPathCase;
  const { refreshCovenBin } = await import("@/lib/coven-bin");
  refreshCovenBin();
  await rm(home, { recursive: true, force: true });
}
