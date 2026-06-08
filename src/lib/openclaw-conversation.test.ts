// @ts-nocheck
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadConversationFromJsonl } from "./openclaw-conversation.ts";

const previousOpenclawHome = process.env.OPENCLAW_HOME;
const root = await mkdtemp(path.join(tmpdir(), "openclaw-conv-"));
process.env.OPENCLAW_HOME = root;

try {
  const sessionDir = path.join(root, "agents", "nova", "sessions");
  await mkdir(sessionDir, { recursive: true });
  await writeFile(
    path.join(sessionDir, "session-1.jsonl"),
    [
      JSON.stringify({
        type: "session",
        id: "session-1",
        version: 1,
        timestamp: "2026-06-08T06:00:00.000Z",
      }),
      JSON.stringify({
        type: "message",
        id: "u1",
        parentId: null,
        timestamp: "2026-06-08T06:00:01.000Z",
        message: {
          role: "user",
          content: [{ type: "text", text: "Show me the recent sessions" }],
        },
      }),
      JSON.stringify({
        type: "message",
        id: "a1",
        parentId: "u1",
        timestamp: "2026-06-08T06:00:02.000Z",
        message: { role: "assistant", content: "Here are the recent sessions." },
      }),
      JSON.stringify({
        type: "message",
        id: "tool1",
        parentId: "a1",
        timestamp: "2026-06-08T06:00:03.000Z",
        message: { role: "tool", content: "internal tool output" },
      }),
    ].join("\n"),
    "utf8",
  );

  const conv = await loadConversationFromJsonl("session-1", "nova");
  assert.equal(conv?.sessionId, "session-1");
  assert.equal(conv?.familiarId, "nova");
  assert.equal(conv?.harness, "openclaw");
  assert.equal(conv?.title, "Show me the recent sessions");
  assert.deepEqual(
    conv?.turns.map((turn) => [turn.role, turn.text]),
    [
      ["user", "Show me the recent sessions"],
      ["assistant", "Here are the recent sessions."],
    ],
  );

  assert.equal(
    await loadConversationFromJsonl("../session-1", "nova"),
    null,
    "session id path traversal should be rejected",
  );
  assert.equal(
    await loadConversationFromJsonl("session-1", "../nova"),
    null,
    "familiar id path traversal should be rejected",
  );
} finally {
  if (previousOpenclawHome === undefined) delete process.env.OPENCLAW_HOME;
  else process.env.OPENCLAW_HOME = previousOpenclawHome;
  await rm(root, { recursive: true, force: true });
}
