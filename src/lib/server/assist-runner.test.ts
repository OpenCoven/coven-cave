// @ts-nocheck
import assert from "node:assert/strict";
import { buildAssistInvocation, ASSIST_TIMEOUT_MS } from "./assist-runner.ts";

const prevBin = process.env.COVEN_CODEX_BIN;

try {
  // ── invocation builder ─────────────────────────────────────────────────────
  delete process.env.COVEN_CODEX_BIN;
  let inv = buildAssistInvocation("PROMPT BODY", "/tmp/last.txt");
  assert.equal(inv.command, "codex");
  // --sandbox read-only is pinned INSIDE the module — deliberately not a
  // parameter — so no caller can quietly widen an assist's privileges: assist
  // prompts embed user-pasted and remote-fetched content (cave-c40b).
  assert.deepEqual(inv.args, ["exec", "--sandbox", "read-only", "--output-last-message", "/tmp/last.txt", "-"]);
  assert.equal(inv.stdinPrompt, "PROMPT BODY");

  process.env.COVEN_CODEX_BIN = "/opt/custom/codex";
  inv = buildAssistInvocation("x", "/tmp/last.txt");
  assert.equal(inv.command, "/opt/custom/codex");

  process.env.COVEN_CODEX_BIN = "   ";
  inv = buildAssistInvocation("x", "/tmp/last.txt");
  assert.equal(inv.command, "codex", "blank override falls back");

  // The default budget matches the sew's historical bound.
  assert.equal(ASSIST_TIMEOUT_MS, 180_000);

  console.log("assist-runner.test.ts OK");
} finally {
  if (prevBin === undefined) delete process.env.COVEN_CODEX_BIN;
  else process.env.COVEN_CODEX_BIN = prevBin;
}
