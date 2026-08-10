import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { buildCodexExecInvocation } from "./automation-runner.ts";

const base = {
  id: "a", name: "A", kind: "cron", status: "ACTIVE" as const, rrule: null,
  reasoningEffort: null, executionEnvironment: null, tags: [], familiars: [],
  skillPath: null, scheduleHuman: "",
};

test("invocation pipes the prompt to codex exec stdin", () => {
  const inv = buildCodexExecInvocation({ ...base, model: null, cwds: ["/repo"], prompt: "do it" });
  assert.equal(inv.args[0], "exec");
  assert.equal(inv.args[inv.args.length - 1], "-");
  assert.equal(inv.cwd, "/repo");
  assert.equal(inv.stdinPrompt, "do it");
  assert.ok(!inv.args.includes("--model"));
});

test("model is passed as --model when set; COVEN_CODEX_BIN overrides the command", () => {
  process.env.COVEN_CODEX_BIN = "/opt/codex";
  const inv = buildCodexExecInvocation({ ...base, model: "gpt-5.4", cwds: [], prompt: "x" });
  assert.equal(inv.command, "/opt/codex");
  assert.deepEqual(inv.args.slice(0, 3), ["exec", "--model", "gpt-5.4"]);
  assert.equal(typeof inv.cwd, "string");
  delete process.env.COVEN_CODEX_BIN;
});

test("automation execution is bounded, redacted, direct, and tree-owned", async () => {
  const source = await readFile(new URL("./automation-runner.ts", import.meta.url), "utf8");
  assert.match(source, /MAX_RUN_LOG_BYTES/);
  assert.match(source, /AUTOMATION_TIMEOUT_MS/);
  assert.match(source, /terminateProcessTree\(child\)/);
  assert.match(source, /safeProcessErrorMessage\(err, "Automation runtime"\)/);
  assert.match(source, /detached: process\.platform !== "win32"/);
  assert.doesNotMatch(source, /\.stdout\?\.pipe\(out\)|\.stderr\?\.pipe\(out\)/);
});
