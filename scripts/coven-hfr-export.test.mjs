import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "coven-hfr-export-"));

function writeConversation(sessionId, familiarId, text, telemetry = {}) {
  writeFileSync(
    path.join(dir, `${sessionId}.json`),
    JSON.stringify({
      sessionId,
      familiarId,
      harness: "codex",
      model: "gpt",
      createdAt: "2026-07-04T10:00:00.000Z",
      turns: [
        {
          id: `${sessionId}-assistant`,
          role: "assistant",
          text,
          createdAt: "2026-07-04T10:00:01.000Z",
          ...telemetry,
        },
      ],
    }),
  );
}

function run(args) {
  return spawnSync(process.execPath, ["--experimental-strip-types", "scripts/coven-hfr-export.ts", ...args], {
    cwd: new URL("..", import.meta.url),
    encoding: "utf8",
  });
}

try {
  const runtimeIdentity = { schemaVersion: 1, harness: "copilot", version: "1.0.82", model: "claude-sonnet-5" };
  writeConversation("sess-a", "cody", "answer a<thinking>PRIVATE_REASONING</thinking>", {
    responseMetadata: { harness: "copilot", runtimeIdentity },
    tools: [{ id: "call-a", name: "view", input: "reader@example.com", output: '{"text":"safe","signature":"PRIVATE_SIGNATURE"}', status: "ok" }],
  });
  writeConversation("sess-b", "cody", "answer b");

  const ambiguous = run(["--dir", dir, "--familiar", "cody"]);
  assert.notEqual(ambiguous.status, 0, "multi-conversation exports must fail");
  assert.match(
    ambiguous.stderr,
    /matched 2 conversation\(s\).*Re-run with --session <id>/,
    "error explains that HFR requires one trace per JSONL file",
  );

  const selected = run(["--dir", dir, "--session", "sess-a"]);
  assert.equal(selected.status, 0, selected.stderr);
  const lines = selected.stdout.trimEnd().split("\n").map((line) => JSON.parse(line));
  assert.ok(lines.length >= 2);
  assert.ok(lines.every((line) => line.session_id === "sess-a"));
  assert.ok(lines.every((line) => typeof line.hook === "string"));
  assert.ok(lines.every((line) => line.type === undefined));
  assert.equal(lines.at(-1).hook, "post_llm_call");
  assert.equal(lines.at(-1).assistant_response, "answer a");
  assert.equal(lines.at(-1).output, "answer a");
  assert.equal(lines[0].model, undefined);
  assert.equal(lines[0].recorded_model, "gpt");
  assert.equal(lines.at(-1).model, "claude-sonnet-5");
  assert.deepEqual(lines.at(-1).runtime_identity, runtimeIdentity);
  assert.deepEqual(lines.find((line) => line.hook === "post_tool_call").runtime_identity, runtimeIdentity);
  assert.doesNotMatch(selected.stdout, /PRIVATE_REASONING|PRIVATE_SIGNATURE|reader@example\.com/);
  assert.match(selected.stderr, /events from session sess-a/);
} finally {
  rmSync(dir, { force: true, recursive: true });
}

console.log("coven-hfr-export.test.mjs: ok");
