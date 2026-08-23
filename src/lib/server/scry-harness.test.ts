// @ts-nocheck
//
// Running a scry on a local harness.
//
// The spawn is injected, so every assertion here is about the launch contract
// and the failure mapping — and not one of them costs a model call.

import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const home = mkdtempSync(path.join(tmpdir(), "cave-scry-harness-"));
process.env.COVEN_CAVE_HOME = home;
// Resolve the launch vehicle deterministically: the runner's own binary is an
// absolute, executable path on every platform the suite runs on. Nothing is
// ever executed — the spawn below is a stub.
process.env.COVEN_BIN = process.execPath;

const { runScry, SCRY_TIMEOUT_MS } = await import("./scry-harness.ts");

/** A child process that never starts anything. */
function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.pid = 424242;
  child.kill = () => true;
  child.killed = false;
  return child;
}

const LIKENESS = path.join(home, "scry", "11111111-1111-4111-8111-111111111111.png");

// ---------------------------------------------------------------------------
// The allowlist is enforced before anything is spawned.
// ---------------------------------------------------------------------------

for (const harness of ["openclaw", "hermes-agent", "", "sh", "../../bin/sh", "codex; rm -rf /"]) {
  let spawned = false;
  const result = await runScry({
    harness,
    instruction: "look",
    likenessPath: LIKENESS,
    spawn: () => {
      spawned = true;
      return fakeChild();
    },
  });
  assert.equal(result.ok, false, `${JSON.stringify(harness)} must be refused`);
  assert.equal(result.status, 400);
  assert.equal(spawned, false, `nothing may be spawned for ${JSON.stringify(harness)}`);
}

// ---------------------------------------------------------------------------
// The launch contract for an accepted harness.
// ---------------------------------------------------------------------------

{
  let seen = null;
  const child = fakeChild();
  const run = runScry({
    harness: "codex",
    instruction: "OPEN-THE-LIKENESS",
    likenessPath: LIKENESS,
    spawn: (command, args, options) => {
      seen = { command, args, options };
      return child;
    },
  });
  child.stdout.emit("data", Buffer.from('{"name":"Wren"}'));
  child.emit("close", 0);
  const result = await run;

  assert.equal(result.ok, true);
  assert.equal(result.output.trim(), '{"name":"Wren"}', "the harness reply comes back for the parser");

  assert.ok(seen, "an accepted harness is spawned");
  assert.equal(seen.args[seen.args.length - 1], "OPEN-THE-LIKENESS", "the instruction is the final argument");
  assert.equal(seen.args[seen.args.length - 2], "--", "the instruction sits behind an end-of-options marker, so it can never be read as a flag");
  assert.ok(seen.args.includes("run"), "the harness is launched through `coven run`");
  assert.ok(seen.args.includes("codex"), "the chosen harness is named");
  assert.equal(
    seen.options.cwd,
    path.dirname(LIKENESS),
    "the process runs in the staging directory, so the likeness is a file in its own cwd",
  );
  assert.equal(seen.options.windowsHide, true, "no console window flashes on Windows");
  assert.equal(
    seen.args.some((arg) => String(arg).includes("--familiar")),
    false,
    "a scry names no familiar — it runs before one exists, which is the point of the endpoint",
  );
}

// ---------------------------------------------------------------------------
// The spawn environment.
//
// NOTE on what this does and does not prove. The vault-scoping guarantee — no
// familiar-scoped secret near a process reading an arbitrary uploaded picture —
// lives in `harnessSpawnEnv(null)`, and it is NOT observable here: with no
// vault.yaml there are no scoped keys to subtract, so passing a familiar id
// would build an identical environment. The guard this suite really carries for
// that property is the `--familiar` assertion above, which is what would make a
// scry familiar-scoped in the first place. What follows only proves the
// environment is a real one rather than an empty object.
// ---------------------------------------------------------------------------

{
  let seen = null;
  const child = fakeChild();
  const run = runScry({
    harness: "claude",
    instruction: "look",
    likenessPath: LIKENESS,
    spawn: (command, args, options) => {
      seen = options;
      return child;
    },
  });
  child.emit("close", 0);
  await run;
  assert.ok(seen.env, "an environment is built for the spawn");
  assert.equal(
    typeof seen.env.PATH === "string" || typeof seen.env.Path === "string",
    true,
    "the scrubbed environment still carries a PATH, or nothing can launch",
  );
}

// ---------------------------------------------------------------------------
// Failure mapping.
// ---------------------------------------------------------------------------

{
  // A non-zero exit is NOT a failure: harnesses routinely exit non-zero after
  // printing a perfectly good answer, and the parser is the authority.
  const child = fakeChild();
  const run = runScry({
    harness: "codex",
    instruction: "look",
    likenessPath: LIKENESS,
    spawn: () => child,
  });
  child.stdout.emit("data", Buffer.from('{"name":"Basil"}'));
  child.emit("close", 3);
  const result = await run;
  assert.equal(result.ok, true, "a non-zero exit with a usable reply is still a reading");
  assert.ok(result.output.includes("Basil"));
}

{
  const child = fakeChild();
  const run = runScry({
    harness: "codex",
    instruction: "look",
    likenessPath: LIKENESS,
    spawn: () => child,
  });
  child.emit("error", new Error("ENOENT"));
  const result = await run;
  assert.equal(result.ok, false, "a runtime that cannot start is a failure");
  assert.equal(result.status, 503);
}

{
  const result = await runScry({
    harness: "codex",
    instruction: "look",
    likenessPath: LIKENESS,
    spawn: () => {
      throw new Error("spawn refused");
    },
  });
  assert.equal(result.ok, false, "a spawn that throws synchronously is a failure, not a crash");
  assert.equal(result.status, 503);
}

{
  const child = fakeChild();
  const started = Date.now();
  const result = await runScry({
    harness: "codex",
    instruction: "look",
    likenessPath: LIKENESS,
    timeoutMs: 40,
    // Never emits close: a harness that hangs must not hang the request.
    spawn: () => child,
  });
  assert.equal(result.ok, false, "a harness that never answers times out");
  assert.equal(result.status, 504);
  assert.ok(Date.now() - started < 5_000, "the timeout fires on its own budget, not the default one");
}

{
  // The reply is bounded: a harness that prints megabytes cannot fill memory
  // before the parser ever sees it.
  const child = fakeChild();
  const run = runScry({
    harness: "codex",
    instruction: "look",
    likenessPath: LIKENESS,
    spawn: () => child,
  });
  // Prose, not a long run of one character: `BoundedProcessOutput` redacts a
  // long unbroken token as a suspected secret, which would shrink the capture
  // on its own and hide whether the BUDGET is doing anything.
  const chatter = Buffer.from("Reading the likeness and thinking about it carefully.\n".repeat(1200), "utf8");
  for (let i = 0; i < 40; i++) child.stdout.emit("data", chatter);
  child.stdout.emit("data", Buffer.from('{"name":"Pip"}'));
  child.emit("close", 0);
  const result = await run;
  assert.equal(result.ok, true);
  assert.ok(
    Buffer.byteLength(result.output) <= 128 * 1024,
    `the captured reply is bounded, got ${Buffer.byteLength(result.output)} bytes`,
  );
  assert.ok(
    result.output.includes("Pip"),
    "the TAIL is kept, so the reply printed last survives a noisy harness",
  );
}

assert.ok(SCRY_TIMEOUT_MS >= 30_000, "the default budget leaves a real harness time to look at a picture");

rmSync(home, { recursive: true, force: true });
console.log("scry harness ok");
