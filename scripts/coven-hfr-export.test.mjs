import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "coven-hfr-export-"));

function writeConversation(sessionId, familiarId, text) {
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
  writeConversation("sess-a", "cody", "answer a");
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
  assert.match(selected.stderr, /events from session sess-a/);
} finally {
  rmSync(dir, { force: true, recursive: true });
}

console.log("coven-hfr-export.test.mjs: ok");
