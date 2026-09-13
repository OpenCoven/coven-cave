import assert from "node:assert/strict";
import { mkdir, readFile, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildChatContinuityChapters } from "../src/lib/chat-continuity-chapters.ts";
import { resolveActivePath } from "../src/lib/conversation-tree.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const scratch = `${root}.scratch-continuity-ios/parity-${process.pid}`;
const probe = spawnSync("swiftc", ["--version"], { encoding: "utf8" });
if (probe.error?.code === "ENOENT") {
  console.log("ios-continuity-parity: SKIP (Swift toolchain unavailable; source contracts still required)");
} else {
  assert.equal(probe.status, 0, probe.stderr);
  await mkdir(`${scratch}/cache`, { recursive: true });
  await mkdir(`${scratch}/home`, { recursive: true });
  const env = { ...process.env, HOME: `${scratch}/home`, CFFIXED_USER_HOME: `${scratch}/home`, TMPDIR: scratch };
  try {
    const compile = spawnSync("swiftc", [
      "-module-cache-path", `${scratch}/cache`,
      `${root}apps/ios/CovenCave/CovenCave/State/ConversationChapters.swift`,
      `${root}apps/ios/ContinuityParity/main.swift`, "-o", `${scratch}/parity`,
    ], { env, encoding: "utf8", timeout: 120_000 });
    assert.equal(compile.status, 0, compile.stderr);
    const t = (id, createdAt = "2026-09-09T00:00:00Z", parentId) => ({ id, createdAt, parentId });
    const golden = JSON.parse(await readFile(`${root}docs/fixtures/familiar-continuity-v1.json`, "utf8"));
    assert.equal(golden.algorithm, "utc-day-v1");
    const validTimestamps = [
      "2024-02-29T00:00:00Z", "2024-02-29T00:00:00.123Z",
      "9999-12-31T23:59:59.999Z", "0000-01-01T00:00:00Z",
    ];
    const invalidTimestamps = [
      "2026-09-09T00:30:00+02:00", "2026-09-08T23:30:00-02:00",
      "2026-09-09T00:00:00+00:00", "2026-09-09T00:00:00-00:00",
      "2026-09-09T00:00:00.1Z", "2026-09-09T00:00:00.12Z",
      "2026-09-09T00:00:00.1234Z", "2024-02-29T00:00:00.123456Z",
      "2026-02-31T00:00:00Z", "2026-02-29T00:00:00Z", "2026-09-09T24:00:00Z",
      "2026-09-09T00:00:00", "2026-09-09T00:00:00+24:00", "2026-09-09T00:00:60Z",
      "2026-09-09T00:00:00Z\n", "2026-13-01T00:00:00Z", "2026-09-09T00:00:00z",
    ];
    const inputs = [
      { conversationId: "exact/chat", turns: [t("a", "2026-09-08T23:59:59Z"), t("b"), t("c"), t("back", "2026-09-08T10:00:00Z")] },
      { conversationId: '"/☃\\\n', turns: [t('turn"\\/\t\u0000')] },
      ...validTimestamps.map((createdAt) => ({ conversationId: "c", turns: [t("a", createdAt)], expectedStatus: "complete" })),
      ...invalidTimestamps.map((createdAt) => ({ conversationId: "c", turns: [t("a", createdAt)], expectedStatus: "unavailable" })),
      { conversationId: "c", turns: [t("a"), t("a")] },
      { conversationId: "", turns: [t("a")] },
      { conversationId: "c", turns: [] },
    ];
    const branchInputs = [
      { conversationId: "c", turns: [t("sibling", undefined, "a"), t("b", "2026-09-08T00:00:00Z", "a"), t("a")], activeLeafId: "b", resolveBranch: true, expectedBranch: ["a", "b"] },
      { conversationId: "c", turns: [t("a", undefined, "missing")], activeLeafId: "a", resolveBranch: true, expectedBranch: null },
      { conversationId: "c", turns: [t("a", undefined, "b"), t("b", undefined, "a")], activeLeafId: "a", resolveBranch: true, expectedBranch: null },
      { conversationId: "c", turns: [t("a"), t("a")], activeLeafId: "a", resolveBranch: true, expectedBranch: null },
      {
        conversationId: "legacy",
        turns: [t("legacy-user", "2026-09-09T00:00:00Z", null), { ...t("legacy-reply", "2026-09-08T00:00:00Z"), role: "assistant" }],
        resolveBranch: true, expectedBranch: ["legacy-user", "legacy-reply"],
      },
      {
        conversationId: "system-root",
        turns: [t("a", undefined, "u"), t("u", undefined, "root"), { ...t("root", "2026-09-08T00:00:00Z", null), role: "system" }],
        activeLeafId: "a", resolveBranch: true, expectedBranch: ["root", "u", "a"],
      },
      {
        conversationId: "system-root-with-echo",
        turns: [
          t("a", undefined, "u"), t("u", undefined, "root"),
          { ...t("echo", "2026-09-07T00:00:00Z", null), role: "system" },
          { ...t("root", "2026-09-08T00:00:00Z", null), role: "system" },
        ],
        activeLeafId: "a", resolveBranch: true, expectedBranch: ["echo", "root", "u", "a"],
      },
      {
        conversationId: "inferred-system-root",
        turns: [t("a", undefined, "u"), t("u", undefined, "root"), { ...t("root", undefined, null), role: "system" }],
        resolveBranch: true, expectedBranch: ["root", "u", "a"],
      },
      {
        conversationId: "ambiguous-linked",
        turns: [t("a"), t("reply", undefined, "a"), t("other-root")],
        resolveBranch: true, expectedBranch: null,
      },
      {
        conversationId: "bad-chain-date-with-echo",
        turns: [t("u", "not-a-date"), t("a", undefined, "u"), { ...t("echo", "2026-09-08T00:00:00Z", null), role: "system" }],
        activeLeafId: "a", resolveBranch: true, expectedBranch: ["u", "echo", "a"],
      },
      {
        conversationId: "bad-echo-date",
        turns: [t("u"), t("a", undefined, "u"), { ...t("echo", "not-a-date", null), role: "system" }],
        activeLeafId: "a", resolveBranch: true, expectedBranch: ["u", "a", "echo"],
      },
      {
        conversationId: "missing-chain-date-with-pre-epoch-echo",
        turns: [{ id: "u" }, t("a", undefined, "u"), { ...t("echo", "1969-12-31T23:59:00Z", null), role: "system" }],
        activeLeafId: "a", resolveBranch: true, expectedBranch: ["echo", "u", "a"],
      },
      {
        conversationId: "missing-echo-date",
        turns: [t("u"), t("a", undefined, "u"), { id: "echo", role: "system", parentId: null }],
        activeLeafId: "a", resolveBranch: true, expectedBranch: ["echo", "u", "a"],
      },
      {
        conversationId: "empty-echo-date",
        turns: [t("u"), t("a", undefined, "u"), { ...t("echo", "", null), role: "system" }],
        activeLeafId: "a", resolveBranch: true, expectedBranch: ["echo", "u", "a"],
      },
      {
        conversationId: "broken-ancestry-with-echo",
        turns: [t("u", "not-a-date", "missing"), { ...t("echo", undefined, null), role: "system" }],
        activeLeafId: "u", resolveBranch: true, expectedBranch: null,
      },
      { conversationId: "c", turns: [t("a")], partial: true },
    ];
    const run = spawnSync(`${scratch}/parity`, [], {
      input: JSON.stringify([...inputs, ...branchInputs, ...golden.cases]), encoding: "utf8", env, timeout: 30_000,
    });
    assert.equal(run.status, 0, run.stderr);
    const results = JSON.parse(run.stdout);
    inputs.forEach((input, index) => {
      if (input.expectedStatus) assert.equal(results[index].status, input.expectedStatus, JSON.stringify(input));
      const expected = buildChatContinuityChapters(input.conversationId, input.turns, false);
      const { branch, ...actual } = results[index];
      assert.deepEqual(actual, expected, JSON.stringify(input));
    });
    const branchResults = results.slice(inputs.length, inputs.length + branchInputs.length);
    branchInputs.forEach((input, index) => {
      const actual = branchResults[index];
      if (input.partial) {
        assert.equal(actual.status, "partial", input.conversationId);
        assert.deepEqual(actual.chapters, [], input.conversationId);
      } else {
        assert.deepEqual(actual.branch, input.expectedBranch, input.conversationId);
        if (input.expectedBranch === null) {
          assert.equal(actual.status, "unavailable", input.conversationId);
          assert.deepEqual(actual.chapters, [], input.conversationId);
        } else {
          if (input.activeLeafId) {
            assert.deepEqual(actual.branch, resolveActivePath(input.turns, input.activeLeafId).map((turn) => turn.id),
              `${input.conversationId}: existing display resolver order`);
          }
          const branch = input.expectedBranch.map((id) => input.turns.find((turn) => turn.id === id));
          const expected = buildChatContinuityChapters(input.conversationId, branch, false);
          assert.equal(actual.status, expected.status, input.conversationId);
          assert.deepEqual(actual.chapters, expected.chapters, input.conversationId);
        }
      }
    });
    golden.cases.forEach((vector, index) => {
      const actual = results[inputs.length + branchInputs.length + index];
      if (vector.expectedError) {
        assert.equal(actual.status, "unavailable", vector.id);
        assert.deepEqual(actual.chapters, [], vector.id);
      } else {
        assert.deepEqual(actual.chapters.map(({ id, day: date, firstTurnId, lastTurnId, turnCount }) => ({
          id, date, firstTurnId, lastTurnId, turnCount,
        })), vector.expected, vector.id);
      }
    });
    console.log(`ios-continuity-parity: ${inputs.length + branchInputs.length} compiled Swift parity cases and ${golden.cases.length} parent golden cases passed`);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}
