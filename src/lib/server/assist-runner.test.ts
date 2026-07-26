// @ts-nocheck
import assert from "node:assert/strict";
import {
  buildAssistInvocation,
  describeEmptyAssistOutput,
  stderrReason,
  ASSIST_TIMEOUT_MS,
} from "./assist-runner.ts";

const prevBin = process.env.COVEN_CODEX_BIN;

try {
  // ── invocation builder ─────────────────────────────────────────────────────
  delete process.env.COVEN_CODEX_BIN;
  let inv = buildAssistInvocation("PROMPT BODY", "/tmp/last.txt");
  assert.equal(inv.command, "codex");
  // --sandbox read-only is pinned INSIDE the module — deliberately not a
  // parameter — so no caller can quietly widen an assist's privileges: assist
  // prompts embed user-pasted and remote-fetched content (cave-c40b).
  // --skip-git-repo-check: assists run in a neutral temp dir, which newer
  // codex refuses as untrusted without the flag; safe under read-only.
  assert.deepEqual(inv.args, [
    "exec",
    "--sandbox",
    "read-only",
    "--skip-git-repo-check",
    "--output-last-message",
    "/tmp/last.txt",
    "-",
  ]);
  assert.equal(inv.stdinPrompt, "PROMPT BODY");

  process.env.COVEN_CODEX_BIN = "/opt/custom/codex";
  inv = buildAssistInvocation("x", "/tmp/last.txt");
  assert.equal(inv.command, "/opt/custom/codex");

  process.env.COVEN_CODEX_BIN = "   ";
  inv = buildAssistInvocation("x", "/tmp/last.txt");
  assert.equal(inv.command, "codex", "blank override falls back");

  // The default budget matches the sew's historical bound.
  assert.equal(ASSIST_TIMEOUT_MS, 180_000);

  // ── stderr reason collapsing ───────────────────────────────────────────────
  assert.equal(stderrReason(""), "");
  assert.equal(stderrReason("  \n\t\n"), "", "whitespace-only tail collapses to nothing");
  assert.equal(
    stderrReason("line1\r\nline2\nline3\n\nline4\n"),
    "line2 · line3 · line4",
    "keeps the last 3 non-empty lines across CRLF",
  );
  assert.equal(stderrReason("x".repeat(400)), "x".repeat(300), "caps at the final 300 chars");

  // ── empty-output diagnostics ───────────────────────────────────────────────
  // Auth-shaped stderr → explicit sign-in guidance with a runnable command.
  let msg = describeEmptyAssistOutput(
    "codex",
    "ERROR: Not logged in. Run `codex login` to authenticate.",
  );
  assert.ok(msg.includes("isn't signed in"), msg);
  assert.ok(msg.includes("`codex login`"), msg);
  assert.ok(msg.includes("Not logged in"), "carries the stderr tail");

  msg = describeEmptyAssistOutput("codex", "request failed: 401 Unauthorized");
  assert.ok(msg.includes("`codex login`"), msg);

  // A COVEN_CODEX_BIN path with spaces still yields a runnable login command,
  // with backslashes escaped ahead of quotes (js/incomplete-sanitization).
  msg = describeEmptyAssistOutput("C:\\Program Files\\codex.exe", "stream error: unauthorized");
  assert.ok(msg.includes('`"C:\\\\Program Files\\\\codex.exe" login`'), msg);

  // Non-auth stderr must NOT claim a sign-in problem — loose `token` / `auth`
  // / `sign ?in` substring matching used to misfire on lines like these.
  for (const stderr of [
    "SyntaxError: Unexpected token < in JSON at position 0",
    "error: not inside a trusted directory; pass --skip-git-repo-check",
    "warning: redesign in progress for the author page catalog index",
  ]) {
    msg = describeEmptyAssistOutput("codex", stderr);
    assert.ok(!msg.includes("signed in"), `false auth positive for: ${stderr}`);
    assert.ok(msg.startsWith("assist produced no output"), msg);
    assert.ok(msg.includes(stderrReason(stderr)), "still surfaces the stderr tail");
  }

  // No stderr at all → the original terse message, no dangling separator.
  assert.equal(describeEmptyAssistOutput("codex", ""), "assist produced no output");

  console.log("assist-runner.test.ts OK");
} finally {
  if (prevBin === undefined) delete process.env.COVEN_CODEX_BIN;
  else process.env.COVEN_CODEX_BIN = prevBin;
}
