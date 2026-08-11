// @ts-nocheck
// Direct copilot spawn for flow sessions (cave-lhc0): the run must launch the
// CLI with a real argv (prompt as ONE argument after -p) and persist the
// finished transcript as a Cave conversation under its session id — where the
// flow transcript endpoint and the research-mission reconcile look first.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawn as nodeSpawn } from "node:child_process";
import { EventEmitter, once } from "node:events";
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";

const REAL_HOME = process.env.HOME;
const REAL_CAVE_HOME = process.env.COVEN_CAVE_HOME;
const TMP = mkdtempSync(join(tmpdir(), "flow-copilot-session-"));
process.env.HOME = TMP;
process.env.COVEN_CAVE_HOME = join(TMP, ".coven", "cave");

after(() => {
  process.env.HOME = REAL_HOME;
  if (REAL_CAVE_HOME === undefined) delete process.env.COVEN_CAVE_HOME;
  else process.env.COVEN_CAVE_HOME = REAL_CAVE_HOME;
});

// Invoke the current Node executable with a JavaScript fixture rather than a
// POSIX shebang. This exercises the direct spawn path on Windows too.
const FAKE = join(TMP, "fake-copilot.js");
writeFileSync(FAKE, `
const { writeFileSync } = require("node:fs");
const { join } = require("node:path");
writeFileSync(join(process.cwd(), "argv.json"), JSON.stringify(process.argv.slice(2)));
console.log(JSON.stringify({ type: "assistant.message_delta", data: { messageId: "m1", deltaContent: "@@research-control\\n" } }));
console.log(JSON.stringify({ type: "tool.execution_complete", data: { toolCallId: "call-1", success: true, result: { content: "/workspace" } } }));
console.log(JSON.stringify({ type: "assistant.message", data: { messageId: "m1", content: "done.\\n@@research-control\\n{\\"decision\\":\\"complete\\",\\"reason\\":\\"ok\\",\\"confidence\\":1}", toolRequests: [{ toolCallId: "call-1", name: "shell", arguments: { command: "pwd" } }] } }));
console.log(JSON.stringify({ type: "tool.execution_start", data: { toolCallId: "call-1", toolName: "shell", arguments: { command: "pwd" } } }));
`);

// Contract-faithful JavaScript provider for cross-platform Cave unit tests.
// Native Job/guardian proof lives in Coven; optional native tests below bind
// the real provider when COVEN_PROCESS_SUPERVISOR_NATIVE is supplied.
const FAKE_SUPERVISOR = join(TMP, "fake-process-supervisor.js");
writeFileSync(FAKE_SUPERVISOR, `
const { spawn } = require("node:child_process");
const prefix = "COVEN_PROCESS_SUPERVISOR_V1 ";
let requestBytes = Buffer.alloc(0);
let target = null;
let stopping = false;
let settled = false;

function signalTarget(signal) {
  if (!target) return;
  try {
    if (process.platform === "win32") target.kill(signal);
    else process.kill(-target.pid, signal);
  } catch {}
}
function finish(code) {
  if (settled) return;
  settled = true;
  if (process.platform !== "win32") signalTarget("SIGKILL");
  setTimeout(() => process.exit(Number.isInteger(code) ? code : 1), 30);
}
function stop() {
  if (stopping || !target) return;
  stopping = true;
  signalTarget("SIGTERM");
  setTimeout(() => signalTarget("SIGKILL"), 40);
}
process.stdin.on("data", (chunk) => {
  if (target) {
    process.stderr.write(prefix + JSON.stringify({ event: "error", code: "invalid_request", message: "extra input" }) + "\\n");
    stop();
    return;
  }
  requestBytes = Buffer.concat([requestBytes, chunk]);
  const newline = requestBytes.indexOf(10);
  if (newline === -1) return;
  try {
    const request = JSON.parse(requestBytes.subarray(0, newline).toString("utf8"));
    if (requestBytes.length !== newline + 1) throw new Error("extra bytes");
    target = spawn(request.program, request.args, {
      cwd: request.cwd,
      env: process.env,
      windowsHide: true,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    target.once("error", () => {
      process.stderr.write(prefix + JSON.stringify({ event: "error", code: "spawn_failed", message: "spawn failed" }) + "\\n");
      finish(70);
    });
    target.once("spawn", () => {
      process.stderr.write(prefix + JSON.stringify({ event: "ready", protocol: "coven.process-supervisor.v1" }) + "\\n");
      target.stdout.pipe(process.stdout);
      target.stderr.pipe(process.stderr, { end: false });
    });
    target.once("close", (code) => finish(code));
  } catch {
    process.stderr.write(prefix + JSON.stringify({ event: "error", code: "invalid_request", message: "invalid" }) + "\\n");
    finish(70);
  }
});
process.stdin.once("end", stop);
process.on("SIGTERM", stop);
setInterval(() => {
  if (stopping && target && (target.exitCode !== null || target.signalCode !== null)) finish(target.exitCode ?? 1);
}, 10).unref();
`);
const TEST_SUPERVISOR = { command: process.execPath, fixedArgs: [FAKE_SUPERVISOR] };

const {
  COPILOT_PROCESS_TERMINATION_GRACE_MS,
  COPILOT_FINISHED_RUN_TOMBSTONE_LIMIT,
  COPILOT_SHUTDOWN_TERMINATION_ATTEMPTS,
  COPILOT_TREE_TERMINATION_BUDGET_MS,
  CopilotArgvTransportError,
  CopilotProcessSupervisorError,
  CopilotPromptTransportError,
  CopilotSupervisorRequestTransportError,
  PACKAGED_UNIX_SIDECAR_SHUTDOWN_LEASE_MS,
  WINDOWS_COPILOT_COMMAND_LINE_SAFE_UNITS,
  assertCopilotCommandLineFitsWindows,
  cancelCopilotFlowRun,
  copilotPromptTransportFailure,
  isCopilotFlowRunActive,
  shutdownCopilotFlowRuns,
  startCopilotFlowRun,
  startCopilotFlowRunWithTransportBoundary,
  terminateCopilotFlowProcessTree,
  windowsCommandLineUtf16Length,
  windowsQuotedArgUtf16Length,
} = await import("./flow-copilot-session.ts");
const { buildCopilotStreamArgs, copilotIdentityPreamble, copilotStreamSpec } = await import("../copilot-stream.ts");
const { compileFlowPrompt } = await import("../flow/flow-compile.ts");
const { buildResearchMissionFlow } = await import("../research-mission-flow.ts");
const {
  RESEARCH_INTENT_MAX_LENGTH,
  validateCreateResearchMissionInput,
} = await import("../research-missions.ts");
const protocol = copilotStreamSpec()?.protocol;
assert.ok(protocol, "the registered Copilot flow fixture uses a validated event protocol");

const SPEC = {
  protocol,
  executable: "copilot",
  prefixArgs: ["--output-format", "json", "--stream", "on", "-p"],
  sessionIdFlag: "--session-id",
  resumeFlag: "--resume",
  modelFlag: "--model",
  addDirFlag: "--add-dir",
  sandboxFullArgs: ["--allow-all"],
  sandboxReadOnlyArgs: [],
};
const FAKE_LAUNCH = { command: process.execPath, fixedArgs: [FAKE] };

async function startConfirmed(launch, runtime = {}) {
  const started = await startCopilotFlowRun(launch, {
    supervisorCommand: TEST_SUPERVISOR,
    ...runtime,
  });
  started.confirmBookkeeping();
  return started;
}

function researchMission(intent, overrides = {}) {
  return {
    version: 1,
    id: "prompt-boundary",
    familiarId: "sage",
    title: "Windows prompt transport",
    intent,
    mode: "autoresearch",
    modeSource: "user",
    deliverable: "findings",
    constraints: [],
    bounds: {
      wallClockMinutes: 240,
      maxIterations: 6,
      sourceTarget: 12,
      checkpointEvery: 1,
      stopWhenCostUnavailable: false,
    },
    status: "planning",
    createdAt: "2026-08-10T12:00:00.000Z",
    updatedAt: "2026-08-10T12:00:00.000Z",
    iterations: [],
    artifacts: [],
    sources: [],
    ...overrides,
  };
}

function flowLaunchArgs(prompt) {
  return buildCopilotStreamArgs({
    spec: SPEC,
    prompt: `${copilotIdentityPreamble("sage", "Sage", "Researcher")}\n\n${prompt}`,
    resumeSessionId: null,
    newSessionId: "11111111-1111-4111-8111-111111111111",
    model: null,
    permissionMode: "unattended",
    addDirs: [],
  });
}

async function waitUntil(predicate, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("timed out waiting for fixture state");
}

test("Windows command-line accounting matches libuv quoting and UTF-16 units", () => {
  assert.equal(windowsQuotedArgUtf16Length(""), 2, "empty argv values are quoted");
  assert.equal(windowsQuotedArgUtf16Length("plain"), 5, "plain tokens need no quotes");
  assert.equal(windowsQuotedArgUtf16Length("two words"), 11, "whitespace adds surrounding quotes");
  assert.equal(windowsQuotedArgUtf16Length('a"b'), 6, "embedded quotes are escaped");
  assert.equal(windowsQuotedArgUtf16Length("a b\\"), 7, "trailing slashes double before the closing quote");
  assert.equal(windowsQuotedArgUtf16Length("😀 x"), 6, "astral Unicode counts as two UTF-16 units");
  assert.equal(
    windowsCommandLineUtf16Length("node.exe", ["", 'a"b', "😀 x"]),
    26,
    "the complete count includes token separators and the terminating NUL",
  );
});

test("the 30,000-unit Windows ceiling is inclusive and rejects before spawn", async () => {
  const command = "copilot.exe";
  const exactPrompt = "x".repeat(WINDOWS_COPILOT_COMMAND_LINE_SAFE_UNITS - command.length - 2);
  assert.equal(windowsCommandLineUtf16Length(command, [exactPrompt]), WINDOWS_COPILOT_COMMAND_LINE_SAFE_UNITS);
  assert.doesNotThrow(() => assertCopilotCommandLineFitsWindows(command, [exactPrompt], "win32"));
  let boundaryError;
  try {
    assertCopilotCommandLineFitsWindows(command, [`${exactPrompt}x`], "win32");
  } catch (error) {
    boundaryError = error;
  }
  assert.ok(boundaryError instanceof CopilotPromptTransportError);
  assert.match(boundaryError.message, /too large for a safe Windows launch.*was not truncated/i);
  assert.deepEqual(copilotPromptTransportFailure(boundaryError), {
    ok: false,
    status: 413,
    error: boundaryError.message,
  });
  assert.equal(copilotPromptTransportFailure(new Error("unrelated spawn failure")), null);

  const runRoot = mkdtempSync(join(TMP, "oversized-run-"));
  await assert.rejects(
    startCopilotFlowRun({
      spec: SPEC,
      prompt: "x".repeat(40_000),
      projectRoot: runRoot,
      familiarId: null,
      spawnCommand: FAKE_LAUNCH,
    }, { platform: "win32" }),
    /Copilot currently accepts this flow prompt only through argv/i,
  );
  assert.equal(existsSync(join(runRoot, "argv.json")), false, "oversized input is rejected before any child starts");
});

test("the direct start seam maps a thrown transport refusal and rethrows unrelated errors", async () => {
  const launch = {
    spec: SPEC,
    prompt: "oversized prompt",
    projectRoot: TMP,
    familiarId: null,
  };
  const transportError = new CopilotPromptTransportError(30_001, 30_000);
  let finishCalls = 0;
  const mapped = await startCopilotFlowRunWithTransportBoundary(
    launch,
    async () => {
      finishCalls += 1;
      return { ok: true };
    },
    () => { throw transportError; },
  );
  assert.deepEqual(mapped, { ok: false, status: 413, error: transportError.message });
  assert.equal(finishCalls, 0, "a refused pre-spawn launch cannot record a running flow");

  const unrelated = new Error("unexpected starter failure");
  await assert.rejects(
    startCopilotFlowRunWithTransportBoundary(launch, async () => ({ ok: true }), () => { throw unrelated; }),
    unrelated,
  );

  const argvError = new CopilotArgvTransportError("argument 7", "contains NUL");
  assert.deepEqual(
    await startCopilotFlowRunWithTransportBoundary(launch, async () => ({ ok: true }), () => { throw argvError; }),
    { ok: false, status: 400, error: argvError.message },
  );
});

test("every final argv token rejects NUL safely before spawn on every platform", async () => {
  const secret = "never-echo-this-secret";
  for (const [command, args, expectedToken] of [
    [`copilot\0${secret}.exe`, ["-p", "safe"], "command"],
    ["copilot.exe", ["-p", `unsafe\0${secret}`], "argument 2"],
  ]) {
    let error;
    try {
      assertCopilotCommandLineFitsWindows(command, args, "linux");
    } catch (caught) {
      error = caught;
    }
    assert.ok(error instanceof CopilotArgvTransportError);
    assert.match(error.message, new RegExp(expectedToken));
    assert.doesNotMatch(error.message, new RegExp(secret), "transport diagnostics never echo argv content");
    assert.deepEqual(copilotPromptTransportFailure(error), {
      ok: false,
      status: 400,
      error: error.message,
    });
  }

  let spawns = 0;
  await assert.rejects(
    startCopilotFlowRun({
      spec: SPEC,
      prompt: `invalid\0${secret}`,
      projectRoot: TMP,
      familiarId: null,
      spawnCommand: FAKE_LAUNCH,
    }, {
      platform: "linux",
      spawnImpl: () => { spawns += 1; throw new Error("must not spawn"); },
    }),
    CopilotArgvTransportError,
  );
  assert.equal(spawns, 0);
});

test("the provider request ceiling is a typed lossless 413 before spawn", async () => {
  const prompt = "oversized-provider-frame-".repeat(14_000);
  let spawns = 0;
  await assert.rejects(
    startCopilotFlowRun({
      spec: SPEC,
      prompt,
      // Exercise the platform-neutral 256 KiB provider frame independently of
      // the tighter Windows argv ceiling. Keep every synthetic path POSIX even
      // when this test itself runs on native Windows so validation reaches the
      // intended size boundary before spawn.
      projectRoot: "/tmp",
      familiarId: null,
      spawnCommand: { command: "/usr/bin/node", fixedArgs: ["/tmp/fake-copilot.js"] },
    }, {
      platform: "linux",
      spawnImpl: () => {
        spawns += 1;
        throw new Error("must not spawn");
      },
    }),
    (error) => {
      assert.ok(error instanceof CopilotSupervisorRequestTransportError);
      assert.equal(error.status, 413);
      assert.match(error.message, /no prompt content was truncated/i);
      assert.doesNotMatch(error.message, /oversized-provider-frame/);
      assert.deepEqual(copilotPromptTransportFailure(error), {
        ok: false,
        status: 413,
        error: error.message,
      });
      return true;
    },
  );
  assert.equal(spawns, 0);
});

test("argv validation rejects unpaired surrogates without rejecting valid Unicode", () => {
  for (const value of ["\ud800", "prefix\udfff", "\ud800x", "x\udfff"]) {
    assert.throws(
      () => assertCopilotCommandLineFitsWindows("copilot.exe", [value], "linux"),
      /unpaired UTF-16 surrogate/,
    );
  }
  for (const value of ["BMP", "astral 😀", "combining e\u0301"]) {
    assert.doesNotThrow(() => assertCopilotCommandLineFitsWindows("copilot.exe", [value], "win32"));
  }
});

test("Unix tree cleanup has real headroom beneath Tauri's exact two-second lease", () => {
  assert.equal(COPILOT_SHUTDOWN_TERMINATION_ATTEMPTS, 1, "app shutdown performs one bounded tree pass");
  assert.equal(
    COPILOT_TREE_TERMINATION_BUDGET_MS,
    COPILOT_SHUTDOWN_TERMINATION_ATTEMPTS * COPILOT_PROCESS_TERMINATION_GRACE_MS * 2,
  );
  assert.ok(
    COPILOT_TREE_TERMINATION_BUDGET_MS <= PACKAGED_UNIX_SIDECAR_SHUTDOWN_LEASE_MS - 500,
    "EOF/TERM proof leaves at least 500ms for scheduling before Tauri's hard fallback",
  );
});

test("deduplicated Research prompts keep the measured 4,500-character case Windows-safe", () => {
  const intent = ("compare \\\"quoted\\\" evidence 😀 ").repeat(300).slice(0, 4_500);
  const flow = buildResearchMissionFlow(researchMission(intent), 1);
  const compiled = compileFlowPrompt(flow);
  assert.equal(compiled.split(intent).length - 1, 1, "the complete intent appears exactly once");
  const command = "C:\\Program Files\\nodejs\\node.exe";
  const fixedArgs = ["C:\\Users\\Researcher\\AppData\\Roaming\\npm\\node_modules\\copilot\\index.js"];
  const units = windowsCommandLineUtf16Length(
    command,
    [...fixedArgs, ...flowLaunchArgs(compiled)],
  );
  assert.ok(units < WINDOWS_COPILOT_COMMAND_LINE_SAFE_UNITS, `measured prompt uses ${units} UTF-16 units`);

  const scopePrompt = String(flow.nodes.find((node) => node.id === "scope")?.params.prompt);
  const contextPrefix = "SHARED RESEARCH MISSION CONTEXT — applies to every Research phase in this Flow:\n";
  const contextSuffix = "\nDefine research questions, inclusion rules, exclusions, and the evidence standard.";
  assert.ok(scopePrompt.startsWith(contextPrefix) && scopePrompt.endsWith(contextSuffix));
  const sharedContext = scopePrompt.slice(contextPrefix.length, -contextSuffix.length);
  // Before this repair every one of the six phase prompts carried the entire
  // context. Re-add the five removed copies to measure the real regression
  // shape rather than merely asserting that the new prompt is smaller.
  const legacySixCopyPrompt = `${compiled}\n${Array.from({ length: 5 }, () => sharedContext).join("\n")}`;
  const legacyUnits = windowsCommandLineUtf16Length(
    command,
    [...fixedArgs, ...flowLaunchArgs(legacySixCopyPrompt)],
  );
  assert.ok(legacyUnits > 34_000, `the former six-copy prompt uses ${legacyUnits} UTF-16 units`);
});

test("the current maximum Research input is measured and pathological quoting fails closed", () => {
  const plainDeliverable = `DELIVERABLE-${"d".repeat(148)}`;
  const plainAudience = `AUDIENCE-${"a".repeat(491)}`;
  const validatedPlain = validateCreateResearchMissionInput({
    ...researchMission("i".repeat(RESEARCH_INTENT_MAX_LENGTH)),
    deliverable: plainDeliverable,
    audience: plainAudience,
    constraints: Array.from({ length: 20 }, () => "c".repeat(500)),
  });
  assert.equal(validatedPlain.ok, true, "the measured plain case is accepted by the Research input contract");
  const maximumPlain = researchMission(validatedPlain.value.intent, {
    ...validatedPlain.value,
    direction: "r".repeat(2_000),
  });
  const plainPrompt = compileFlowPrompt(buildResearchMissionFlow(maximumPlain, 1));
  assert.equal(plainPrompt.split(plainDeliverable).length - 1, 1);
  assert.equal(plainPrompt.split(plainAudience).length - 1, 1);
  const plainArgs = flowLaunchArgs(plainPrompt);
  assert.doesNotThrow(() => assertCopilotCommandLineFitsWindows("copilot.exe", plainArgs, "win32"));

  const validatedQuoted = validateCreateResearchMissionInput({
    ...researchMission('"'.repeat(RESEARCH_INTENT_MAX_LENGTH)),
    constraints: Array.from({ length: 20 }, () => '"'.repeat(500)),
  });
  assert.equal(validatedQuoted.ok, true, "worst-case quoting is also a valid Research input");
  const maximumQuoted = researchMission(validatedQuoted.value.intent, {
    ...validatedQuoted.value,
    direction: '"'.repeat(2_000),
  });
  const quotedPrompt = compileFlowPrompt(buildResearchMissionFlow(maximumQuoted, 1));
  const quotedArgs = flowLaunchArgs(quotedPrompt);
  assert.ok(
    windowsCommandLineUtf16Length("copilot.exe", quotedArgs) > WINDOWS_COPILOT_COMMAND_LINE_SAFE_UNITS,
    "valid input with worst-case Windows quoting can still exceed the bounded transport",
  );
  assert.throws(
    () => assertCopilotCommandLineFitsWindows("copilot.exe", quotedArgs, "win32"),
    /Shorten the Research mission intent or use a runtime with stdin prompt support/,
  );
});

function readConversation(sessionId) {
  return JSON.parse(readFileSync(
    join(TMP, ".coven", "cave", "conversations", `${sessionId}.json`),
    "utf8",
  ));
}

test("the supervisor carries one complete prompt argv and persists stdout as the transcript", async () => {
  const prompt = "Mission: cave-test\nIteration 1 of 3.\nGather sources and print markers.";
  const { sessionId, done } = await startConfirmed({
    spec: SPEC,
    prompt,
    projectRoot: TMP,
    familiarId: "sage",
    familiarName: "Sage",
    familiarRole: "Researcher",
    permissionMode: "unattended",
    spawnCommand: FAKE_LAUNCH,
  });
  assert.match(sessionId, /^[0-9a-f-]{36}$/);
  await done;

  const argv = JSON.parse(readFileSync(join(TMP, "argv.json"), "utf8"));
  const promptIndex = argv.indexOf("-p") + 1;
  assert.ok(promptIndex > 0, "prompt flag present");
  assert.match(argv[promptIndex], /Mission: cave-test/);
  assert.match(argv[promptIndex], /Gather sources and print markers\./);
  assert.match(argv[promptIndex], /\[Identity: You are Sage, a Researcher\./);
  assert.equal(argv.length, promptIndex + 1, "the complete prompt is one final argv token");
  assert.ok(argv.includes("--session-id"), "fresh session id is pre-assigned");
  assert.ok(!argv.includes("--add-dir"), "no trust flags when addDirs is omitted");
  assert.ok(argv.includes("--allow-all-tools"), "unattended runs pre-approve tools");
  assert.ok(argv.includes("--allow-all-urls"), "unattended runs pre-approve URL fetches");
  assert.ok(!argv.includes("--allow-all"), "path verification stays on");
  assert.ok(!argv.includes("--allow-all-paths"), "writes stay confined to cwd + explicit grants");

  const conv = readConversation(sessionId);
  assert.deepEqual(conv.turns.map((turn) => turn.role), ["user", "assistant"]);
  assert.match(conv.turns[1].text, /@@research-control/);
  assert.match(conv.turns[1].text, /"decision":"complete"/);
  assert.ok(!conv.turns[1].isError);
  assert.equal(conv.turns[1].tools?.length, 1);
  assert.deepEqual(
    { ...conv.turns[1].tools[0], durationMs: undefined },
    {
      id: "call-1",
      name: "shell",
      input: '{\n  "command": "pwd"\n}',
      output: "/workspace",
      status: "ok",
      textOffset: conv.turns[1].text.length,
      durationMs: undefined,
    },
  );
});

test("the exact supervisor launch is hidden, shell-free, piped, and not detached", async () => {
  const quick = join(TMP, "fake-copilot-spawn-options.js");
  writeFileSync(quick, "process.exit(0);\n");
  let observed;
  const started = await startConfirmed({
    spec: SPEC,
    prompt: "verify supervisor launch options",
    projectRoot: TMP,
    familiarId: null,
    spawnCommand: { command: process.execPath, fixedArgs: [quick] },
  }, {
    spawnImpl(command, args, options) {
      observed = { command, args, options };
      return nodeSpawn(command, args, options);
    },
    saveConversationImpl: async () => {},
  });
  await started.done;
  assert.equal(observed.command, TEST_SUPERVISOR.command);
  assert.deepEqual(observed.args, TEST_SUPERVISOR.fixedArgs);
  assert.equal(observed.options.windowsHide, true);
  assert.equal(observed.options.detached, false);
  assert.deepEqual(observed.options.stdio, ["pipe", "pipe", "pipe"]);
  assert.equal(observed.options.shell, false);
});

test("addDirs remain deduplicated target argv grants ahead of the prompt", async () => {
  const runRoot = mkdtempSync(join(TMP, "adddir-run-"));
  const workspace = join(TMP, "familiar-workspace");
  const secondWorkspace = join(TMP, "second-familiar-workspace");
  const { done } = await startConfirmed({
    spec: SPEC,
    prompt: "hello",
    projectRoot: runRoot,
    familiarId: "sage",
    addDirs: [` ${workspace} `, "", runRoot, workspace, secondWorkspace],
    spawnCommand: FAKE_LAUNCH,
  });
  await done;
  const argv = JSON.parse(readFileSync(join(runRoot, "argv.json"), "utf8"));
  const flagIndexes = argv.flatMap((arg, index) => arg === "--add-dir" ? [index] : []);
  assert.deepEqual(
    flagIndexes.map((index) => argv[index + 1]),
    [workspace, secondWorkspace],
  );
  assert.ok(flagIndexes[0] < argv.indexOf("-p"));
});

test("a provider spawn error fails closed before bookkeeping or transcript persistence", async () => {
  const before = existsSync(join(TMP, ".coven", "cave", "conversations"))
    ? statSync(join(TMP, ".coven", "cave", "conversations")).mtimeMs
    : 0;
  let bookkeeping = 0;
  const result = await startCopilotFlowRunWithTransportBoundary({
    spec: SPEC,
    prompt: "must not become a running flow",
    projectRoot: TMP,
    familiarId: null,
    spawnCommand: { command: join(TMP, "missing-copilot-native"), fixedArgs: [] },
  }, async () => {
    bookkeeping += 1;
    return { ok: true };
  }, (launch) => startCopilotFlowRun(launch, { supervisorCommand: TEST_SUPERVISOR }));
  assert.equal(result.ok, false);
  assert.equal(result.status, 409);
  assert.match(result.error, /native process supervisor could not start Copilot/i);
  assert.equal(bookkeeping, 0);
  if (before > 0) {
    assert.equal(statSync(join(TMP, ".coven", "cave", "conversations")).mtimeMs, before);
  }
});

test("a non-zero target exit preserves stdout diagnostics but never raw stderr", async () => {
  const partial = join(TMP, "fake-copilot-partial.js");
  writeFileSync(partial, `
console.log(JSON.stringify({ type: "assistant.message", data: { messageId: "m1", content: "partial findings before the crash" } }));
console.error("boom: model backend dropped");
process.exit(3);
`);
  const { sessionId, done } = await startConfirmed({
    spec: SPEC,
    prompt: "hello",
    projectRoot: TMP,
    familiarId: null,
    spawnCommand: { command: process.execPath, fixedArgs: [partial] },
  });
  await done;
  const assistant = readConversation(sessionId).turns.find((turn) => turn.role === "assistant");
  assert.ok(assistant.isError);
  assert.match(assistant.text, /partial findings before the crash/);
  assert.match(assistant.text, /Copilot exited with code 3\./);
  assert.doesNotMatch(assistant.text, /boom: model backend dropped/);
});

test("a protocol failure result marks a zero-exit target as failed", async () => {
  const fixture = join(TMP, "fake-copilot-result-failure.js");
  writeFileSync(fixture, `
console.log(JSON.stringify({ type: "assistant.message", data: { messageId: "m1", content: "the CLI reported a failure" } }));
console.log(JSON.stringify({ type: "result", sessionId: "result-failure", exitCode: 1, usage: { durationMs: 12 } }));
`);
  const { sessionId, done } = await startConfirmed({
    spec: SPEC,
    prompt: "hello",
    projectRoot: TMP,
    familiarId: null,
    spawnCommand: { command: process.execPath, fixedArgs: [fixture] },
  });
  await done;
  const assistant = readConversation(sessionId).turns.find((turn) => turn.role === "assistant");
  assert.ok(assistant.isError);
  assert.match(assistant.text, /Copilot reported a failed result\./);
});

function supervisorDouble() {
  return Object.assign(new EventEmitter(), {
    pid: 4242,
    exitCode: null,
    signalCode: null,
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill() { throw new Error("unexpected abrupt supervisor kill"); },
  });
}

test("owner EOF is the primary exact-handle cancellation path", async () => {
  const child = supervisorDouble();
  let ownerClosed = 0;
  await terminateCopilotFlowProcessTree(child, {
    platform: "win32",
    closeOwnerInput: async () => { ownerClosed += 1; },
    waitForClose: async () => true,
    signalSupervisor: () => { throw new Error("Windows cancellation must not kill after orderly EOF"); },
  });
  assert.equal(ownerClosed, 1);
});

test("Windows cancellation fails closed when EOF lacks orderly quiescence proof", async () => {
  const child = supervisorDouble();
  let signals = 0;
  await assert.rejects(
    terminateCopilotFlowProcessTree(child, {
      platform: "win32",
      closeOwnerInput: async () => {},
      waitForClose: async () => false,
      signalSupervisor: () => { signals += 1; },
    }),
    /did not close after owner EOF/,
  );
  assert.equal(signals, 0, "TerminateProcess is a crash backstop, never user-cancel proof");
});

test("POSIX cancellation may use one orderly TERM fallback but never SIGKILL as proof", async () => {
  const child = supervisorDouble();
  const signals = [];
  let waits = 0;
  await terminateCopilotFlowProcessTree(child, {
    platform: "linux",
    closeOwnerInput: async () => {},
    waitForClose: async () => (++waits === 2),
    signalSupervisor: (_supervisor, signal) => signals.push(signal),
  });
  assert.deepEqual(signals, ["SIGTERM"]);

  const unproved = supervisorDouble();
  const failedSignals = [];
  await assert.rejects(
    terminateCopilotFlowProcessTree(unproved, {
      platform: "linux",
      closeOwnerInput: async () => {},
      waitForClose: async () => false,
      signalSupervisor: (_supervisor, signal) => failedSignals.push(signal),
    }),
    /did not close after EOF and TERM/,
  );
  assert.deepEqual(failedSignals, ["SIGTERM"], "SIGKILL cannot establish synchronous tree quiescence");
});

test("a naturally closed supervisor releases ownership without retaining any PID", async () => {
  const quick = join(TMP, "fake-copilot-natural-close.js");
  writeFileSync(quick, "process.exit(0);\n");
  const started = await startConfirmed({
    spec: SPEC,
    prompt: "finish before a later cancellation request",
    projectRoot: TMP,
    familiarId: null,
    spawnCommand: { command: process.execPath, fixedArgs: [quick] },
  }, { saveConversationImpl: async () => {} });
  await started.done;
  assert.equal(isCopilotFlowRunActive(started.sessionId), false);
  assert.equal(await cancelCopilotFlowRun(started.sessionId), "already-finished");

  let daemonCalls = 0;
  const { cancelResearchSession } = await import("./research-mission-runner.ts");
  await cancelResearchSession(started.sessionId, {
    callDaemonImpl: async () => {
      daemonCalls += 1;
      return { ok: false, status: 0, error: "offline" };
    },
  });
  assert.equal(daemonCalls, 0, "settled direct ownership never falls through to an offline daemon");
});

test("finished direct-run ownership is hot-reload-safe, bounded, and expiring", async () => {
  const registry = globalThis.__covenCaveFinishedCopilotFlowRuns;
  assert.ok(registry, "the settled-run registry is stored on globalThis for hot reloads");
  const original = new Map(registry);
  try {
    registry.clear();
    const now = Date.now();
    registry.set("expired-direct-run", now - 1);
    registry.set("settled-direct-run", now + 60_000);
    assert.equal(await cancelCopilotFlowRun("expired-direct-run"), "not-owned");
    assert.equal(await cancelCopilotFlowRun("settled-direct-run"), "already-finished");

    registry.clear();
    for (let index = 0; index < COPILOT_FINISHED_RUN_TOMBSTONE_LIMIT + 5; index += 1) {
      registry.set(`settled-${index}`, now + 60_000);
    }
    assert.equal(await cancelCopilotFlowRun("unknown-direct-run"), "not-owned");
    assert.equal(registry.size, COPILOT_FINISHED_RUN_TOMBSTONE_LIMIT);
    assert.equal(registry.has("settled-0"), false, "the oldest settled evidence is evicted first");
    assert.equal(globalThis.__covenCaveFinishedCopilotFlowRuns, registry);
  } finally {
    registry.clear();
    for (const [sessionId, expiresAt] of original) registry.set(sessionId, expiresAt);
  }
});

const TREE_WORKER_SOURCE = [
  'const { appendFileSync } = require("node:fs");',
  "const marker = process.argv[1];",
  'process.on("SIGTERM", () => {});',
  'setInterval(() => appendFileSync(marker, "worker\\n"), 10);',
].join("\n");
const TREE_FIXTURE = join(TMP, "fake-copilot-tree.js");
writeFileSync(TREE_FIXTURE, `
const { appendFileSync } = require("node:fs");
const { spawn } = require("node:child_process");
const marker = process.argv[2];
spawn(process.execPath, ["-e", ${JSON.stringify(TREE_WORKER_SOURCE)}, marker], { stdio: "ignore" });
process.on("SIGTERM", () => {});
setInterval(() => appendFileSync(marker, "parent\\n"), 10);
`);
const ROOT_EXITS_ON_TERM_FIXTURE = join(TMP, "fake-copilot-root-exits-on-term.js");
writeFileSync(ROOT_EXITS_ON_TERM_FIXTURE, `
const { appendFileSync } = require("node:fs");
const { spawn } = require("node:child_process");
const marker = process.argv[2];
spawn(process.execPath, ["-e", ${JSON.stringify(TREE_WORKER_SOURCE)}, marker], { stdio: "ignore" });
process.on("SIGTERM", () => {
  appendFileSync(marker, "parent-term\\n");
  process.exit(0);
});
setInterval(() => appendFileSync(marker, "parent\\n"), 10);
`);

async function startTreeFixture(runRoot, marker, runtime = {}, fixture = TREE_FIXTURE) {
  return startConfirmed({
    spec: SPEC,
    prompt: "keep working until the owner stops the complete tree",
    projectRoot: runRoot,
    familiarId: null,
    spawnCommand: { command: process.execPath, fixedArgs: [fixture, marker] },
  }, {
    timeoutMs: 10_000,
    graceMs: 120,
    ...runtime,
  });
}

test("POSIX cancellation escalates after the root exits and leaves no descendant writes", {
  skip: process.platform === "win32" ? "requires native POSIX process-group observation" : false,
}, async () => {
  const runRoot = mkdtempSync(join(TMP, "root-exits-tree-"));
  const marker = join(runRoot, "heartbeat.log");
  const started = await startTreeFixture(runRoot, marker, {}, ROOT_EXITS_ON_TERM_FIXTURE);
  await waitUntil(() => existsSync(marker) && statSync(marker).size > 0);

  assert.equal(await cancelCopilotFlowRun(started.sessionId), "terminated");
  await started.done;
  assert.match(readFileSync(marker, "utf8"), /parent-term/, "the group leader exited on TERM before proof completed");
  const stableSize = statSync(marker).size;
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(statSync(marker).size, stableSize, "the TERM-ignoring worker was escalated before cancel returned");
});

test("double cancel shares one tree termination and resolves only after output is quiescent", async () => {
  const runRoot = mkdtempSync(join(TMP, "cancel-tree-"));
  const marker = join(runRoot, "heartbeat.log");
  let terminations = 0;
  const started = await startTreeFixture(runRoot, marker, {
    terminateProcessTree: async (child, dependencies) => {
      terminations += 1;
      await terminateCopilotFlowProcessTree(child, dependencies);
    },
  });
  await waitUntil(() => existsSync(marker) && statSync(marker).size > 0);

  const [first, second] = await Promise.all([
    cancelCopilotFlowRun(started.sessionId),
    cancelCopilotFlowRun(started.sessionId),
  ]);
  assert.deepEqual([first, second], ["terminated", "terminated"]);
  assert.equal(terminations, 1, "concurrent cancellation shares the same termination promise");
  await started.done;
  assert.equal(isCopilotFlowRunActive(started.sessionId), false);

  const stableSize = statSync(marker).size;
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(statSync(marker).size, stableSize, "no descendant writes after cancellation resolves");
});

test("bookkeeping failure stops the exact tree and discards all captured output", async () => {
  const runRoot = mkdtempSync(join(TMP, "bookkeeping-abort-"));
  const marker = join(runRoot, "heartbeat.log");
  let sessionId = "";
  let saves = 0;
  const result = await startCopilotFlowRunWithTransportBoundary({
    spec: SPEC,
    prompt: "start but do not survive failed bookkeeping",
    projectRoot: runRoot,
    familiarId: null,
    spawnCommand: { command: process.execPath, fixedArgs: [TREE_FIXTURE, marker] },
  }, async (startedSessionId) => {
    sessionId = startedSessionId;
    await waitUntil(() => existsSync(marker) && statSync(marker).size > 0);
    throw new Error("durable run save failed");
  }, (launch) => startCopilotFlowRun(launch, {
    supervisorCommand: TEST_SUPERVISOR,
    graceMs: 120,
    saveConversationImpl: async () => { saves += 1; },
  }));
  assert.deepEqual(result, {
    ok: false,
    status: 500,
    error: "The agent session started, but Cave could not record its Flow run. The process tree was stopped before the start returned.",
  });
  assert.equal(isCopilotFlowRunActive(sessionId), false);
  assert.equal(saves, 0, "captured output is discarded when bookkeeping never commits");
  const stableSize = statSync(marker).size;
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(statSync(marker).size, stableSize);
});

test("failed bookkeeping cleanup retains the exact owner for an idempotent retry", async () => {
  const runRoot = mkdtempSync(join(TMP, "bookkeeping-retained-"));
  const marker = join(runRoot, "heartbeat.log");
  let allowCleanup = false;
  let attempts = 0;
  let saves = 0;
  const result = await startCopilotFlowRunWithTransportBoundary({
    spec: SPEC,
    prompt: "retain the exact process owner if cleanup cannot be proved",
    projectRoot: runRoot,
    familiarId: null,
    spawnCommand: { command: process.execPath, fixedArgs: [TREE_FIXTURE, marker] },
  }, async () => {
    await waitUntil(() => existsSync(marker) && statSync(marker).size > 0);
    throw new Error("durable run save failed");
  }, (launch) => startCopilotFlowRun(launch, {
    supervisorCommand: TEST_SUPERVISOR,
    graceMs: 120,
    terminateProcessTree: async (child, dependencies) => {
      attempts += 1;
      if (!allowCleanup) throw new Error("tree proof temporarily unavailable");
      await terminateCopilotFlowProcessTree(child, dependencies);
    },
    saveConversationImpl: async () => { saves += 1; },
  }));
  assert.equal(result.ok, false);
  assert.equal(result.cleanupUnconfirmed, true);
  assert.match(result.sessionId, /^[0-9a-f-]{36}$/);
  assert.equal(isCopilotFlowRunActive(result.sessionId), true);
  allowCleanup = true;
  assert.equal(await cancelCopilotFlowRun(result.sessionId), "terminated");
  assert.equal(attempts, 2);
  assert.equal(isCopilotFlowRunActive(result.sessionId), false);
  assert.equal(saves, 0);
});

test("cancel racing a closed child waits for transcript persistence", async () => {
  const quick = join(TMP, "fake-copilot-quick.js");
  writeFileSync(quick, "process.exit(0);\n");
  let saveStarted!: () => void;
  const saving = new Promise((resolve) => { saveStarted = resolve; });
  let releaseSave!: () => void;
  const saveGate = new Promise((resolve) => { releaseSave = resolve; });
  const started = await startConfirmed({
    spec: SPEC,
    prompt: "finish immediately",
    projectRoot: TMP,
    familiarId: null,
    spawnCommand: { command: process.execPath, fixedArgs: [quick] },
  }, {
    supervisorCommand: TEST_SUPERVISOR,
    saveConversationImpl: async () => {
      saveStarted();
      await saveGate;
    },
  });
  await saving;
  assert.equal(isCopilotFlowRunActive(started.sessionId), true, "ownership remains until persistence settles");
  let cancelSettled = false;
  const cancelling = cancelCopilotFlowRun(started.sessionId).then((result) => {
    cancelSettled = true;
    return result;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(cancelSettled, false, "cancel does not outrun close-time persistence");
  releaseSave();
  assert.equal(await cancelling, "already-finished");
  await started.done;
  assert.equal(isCopilotFlowRunActive(started.sessionId), false);
});

test("timeout uses the owned-tree terminator", async () => {
  const runRoot = mkdtempSync(join(TMP, "timeout-tree-"));
  const marker = join(runRoot, "heartbeat.log");
  let terminations = 0;
  const started = await startTreeFixture(runRoot, marker, {
    // Native Windows needs materially longer than POSIX to admit the fixture
    // supervisor and start its target. Prove the target actually ran before
    // waiting for the timeout so a scheduler race cannot masquerade as tree
    // cleanup evidence.
    timeoutMs: 2_000,
    terminateProcessTree: async (child, dependencies) => {
      terminations += 1;
      await terminateCopilotFlowProcessTree(child, dependencies);
    },
  });
  await waitUntil(() => existsSync(marker) && statSync(marker).size > 0);
  await started.done;
  assert.equal(terminations, 1);
  assert.equal(isCopilotFlowRunActive(started.sessionId), false);
  const stableSize = statSync(marker).size;
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(statSync(marker).size, stableSize, "timed-out descendants stay stopped");
});

test("timeout remains a persisted error when orderly cancellation produces exit zero", async () => {
  const fixture = join(TMP, "fake-copilot-zero-on-term.js");
  writeFileSync(fixture, `
console.log(JSON.stringify({ type: "assistant.message", data: { messageId: "m-timeout", content: "partial work before a trapped TERM" } }));
process.on("SIGTERM", () => process.exit(0));
setInterval(() => {}, 1000);
`);
  let persisted;
  const secretPrompt = "sensitive-timeout-prompt-must-not-enter-diagnostics";
  const started = await startConfirmed({
    spec: SPEC,
    prompt: secretPrompt,
    projectRoot: TMP,
    familiarId: null,
    spawnCommand: { command: process.execPath, fixedArgs: [fixture] },
  }, {
    timeoutMs: 80,
    graceMs: 120,
    saveConversationImpl: async (conversation) => { persisted = conversation; },
  });
  await started.done;
  const assistant = persisted.turns.find((turn) => turn.role === "assistant");
  assert.equal(assistant.isError, true, "timeout wins over the child's cooperative zero exit");
  assert.match(assistant.text, /exceeded its execution timeout and was stopped/);
  assert.doesNotMatch(assistant.text, new RegExp(secretPrompt), "the timeout diagnostic never echoes the prompt");
});

const NATIVE_SUPERVISOR_PATH = process.env.COVEN_PROCESS_SUPERVISOR_NATIVE;
const NATIVE_SUPERVISOR = NATIVE_SUPERVISOR_PATH
  ? {
      command: NATIVE_SUPERVISOR_PATH,
      fixedArgs: ["process-supervisor", "--protocol", "coven.process-supervisor.v1"],
    }
  : null;

test("the real native provider proves EOF cancellation and descendant quiescence", {
  skip: NATIVE_SUPERVISOR ? false : "set COVEN_PROCESS_SUPERVISOR_NATIVE to the exact provider binary",
}, async () => {
  const runRoot = mkdtempSync(join(TMP, "native-provider-cancel-"));
  const marker = join(runRoot, "heartbeat.log");
  const started = await startConfirmed({
    spec: SPEC,
    prompt: "native provider cancellation",
    projectRoot: runRoot,
    familiarId: null,
    spawnCommand: { command: process.execPath, fixedArgs: [TREE_FIXTURE, marker] },
  }, {
    supervisorCommand: NATIVE_SUPERVISOR,
    graceMs: 1_000,
    saveConversationImpl: async () => {},
  });
  await waitUntil(() => existsSync(marker) && statSync(marker).size > 0);
  assert.equal(await cancelCopilotFlowRun(started.sessionId), "terminated");
  await started.done;
  const stableSize = statSync(marker).size;
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(statSync(marker).size, stableSize);
});

test("the real native owner lease contains a target after the Cave server crashes", {
  skip: NATIVE_SUPERVISOR ? false : "set COVEN_PROCESS_SUPERVISOR_NATIVE to the exact provider binary",
}, async () => {
  const runRoot = mkdtempSync(join(TMP, "native-provider-crash-"));
  const marker = join(runRoot, "heartbeat.log");
  const ready = join(runRoot, "owner-ready");
  const helper = join(runRoot, "cave-owner.js");
  const moduleUrl = new URL("./flow-copilot-session.ts", import.meta.url).href;
  writeFileSync(helper, `
const { writeFileSync } = require("node:fs");
(async () => {
  const flow = await import(${JSON.stringify(moduleUrl)});
  const protocol = ${JSON.stringify(protocol)};
  const started = await flow.startCopilotFlowRun({
    spec: ${JSON.stringify(SPEC)},
    prompt: "server crash lease",
    projectRoot: ${JSON.stringify(runRoot)},
    familiarId: null,
    spawnCommand: { command: ${JSON.stringify(process.execPath)}, fixedArgs: [${JSON.stringify(TREE_FIXTURE)}, ${JSON.stringify(marker)}] },
  }, {
    supervisorCommand: { command: ${JSON.stringify(NATIVE_SUPERVISOR_PATH)}, fixedArgs: ["process-supervisor", "--protocol", "coven.process-supervisor.v1"] },
    timeoutMs: 10000,
  });
  started.confirmBookkeeping();
  writeFileSync(${JSON.stringify(ready)}, started.sessionId);
  setInterval(() => {}, 1000);
})().catch((error) => { console.error(error); process.exit(1); });
`);
  const owner = nodeSpawn(process.execPath, ["--experimental-strip-types", helper], {
    cwd: runRoot,
    windowsHide: true,
    stdio: "ignore",
  });
  await waitUntil(() => existsSync(ready) && existsSync(marker) && statSync(marker).size > 0, 5_000);
  owner.kill(process.platform === "win32" ? undefined : "SIGKILL");
  await once(owner, "close");

  let lastSize = -1;
  let stableSince = Date.now();
  await waitUntil(() => {
    const size = statSync(marker).size;
    if (size !== lastSize) {
      lastSize = size;
      stableSince = Date.now();
      return false;
    }
    return Date.now() - stableSince >= 250;
  }, 5_000);
  const stableSize = statSync(marker).size;
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(statSync(marker).size, stableSize);
});

test("app shutdown seals admission, proves trees before persistence, and retains failed proof", async () => {
  const successRoot = mkdtempSync(join(TMP, "shutdown-success-tree-"));
  const successMarker = join(successRoot, "heartbeat.log");
  let successfulTerminations = 0;
  let saveStarted!: () => void;
  const saving = new Promise((resolve) => { saveStarted = resolve; });
  let releaseSave!: () => void;
  const saveGate = new Promise((resolve) => { releaseSave = resolve; });
  const successful = await startTreeFixture(successRoot, successMarker, {
    terminateProcessTree: async (child, dependencies) => {
      successfulTerminations += 1;
      await terminateCopilotFlowProcessTree(child, dependencies);
    },
    saveConversationImpl: async () => {
      saveStarted();
      await saveGate;
    },
  });
  const failedRoot = mkdtempSync(join(TMP, "shutdown-failed-tree-"));
  const failedMarker = join(failedRoot, "heartbeat.log");
  let allowTermination = false;
  let failedAttempts = 0;
  const failed = await startTreeFixture(failedRoot, failedMarker, {
    terminateProcessTree: async (child, dependencies) => {
      failedAttempts += 1;
      if (!allowTermination) throw new Error("termination temporarily unavailable");
      await terminateCopilotFlowProcessTree(child, dependencies);
    },
  });
  let releaseResolution!: () => void;
  const resolutionGate = new Promise((resolve) => { releaseResolution = resolve; });
  let raceSpawns = 0;
  const racingAdmission = startCopilotFlowRun({
    spec: SPEC,
    prompt: "must not spawn after shutdown seals admission",
    projectRoot: TMP,
    familiarId: null,
    spawnCommand: FAKE_LAUNCH,
  }, {
    resolveSupervisorCommand: async () => {
      await resolutionGate;
      return TEST_SUPERVISOR;
    },
    spawnImpl: (...args) => {
      raceSpawns += 1;
      return nodeSpawn(...args);
    },
  });
  const racingAdmissionRefused = assert.rejects(
    racingAdmission,
    /Cave is shutting down; a new direct Copilot flow cannot be started/,
  );
  await Promise.all([
    waitUntil(() => existsSync(successMarker) && statSync(successMarker).size > 0),
    waitUntil(() => existsSync(failedMarker) && statSync(failedMarker).size > 0),
  ]);

  const shuttingDown = shutdownCopilotFlowRuns();
  releaseResolution();
  await assert.rejects(
    startTreeFixture(mkdtempSync(join(TMP, "shutdown-refused-")), join(TMP, "never.log")),
    /Cave is shutting down; a new direct Copilot flow cannot be started/,
    "the global gate closes before shutdown takes its active-run snapshot",
  );
  await assert.rejects(
    shuttingDown,
    /Could not terminate 1 direct Copilot process tree.*bounded app shutdown/,
  );
  await racingAdmissionRefused;
  assert.equal(raceSpawns, 0, "an in-flight provider probe cannot reopen process admission");
  await saving;
  let doneSettled = false;
  void successful.done.then(() => { doneSettled = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(doneSettled, false, "shutdown tree proof does not wait for an unbounded persistence write");
  assert.equal(successfulTerminations, 1, "the successful owner receives one bounded shutdown pass");
  releaseSave();
  await successful.done;
  assert.equal(isCopilotFlowRunActive(successful.sessionId), false);
  assert.equal(failedAttempts, 1, "shutdown stays within its single-pass native lease budget");
  assert.equal(isCopilotFlowRunActive(failed.sessionId), true, "failed proof cannot discard ownership");

  allowTermination = true;
  assert.equal(await cancelCopilotFlowRun(failed.sessionId), "terminated");
  await failed.done;
  assert.equal(failedAttempts, 2, "a later explicit cancel receives a fresh attempt");
  assert.equal(isCopilotFlowRunActive(failed.sessionId), false);
});
