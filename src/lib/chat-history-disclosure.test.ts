import assert from "node:assert/strict";
import { test } from "node:test";
import { mapConversationHistoryTurns, type ToolEvent } from "./chat-turn-state.ts";
import { runRailModel } from "./chat-run-rail.ts";
import { turnSkills } from "./chat-tool-batches.ts";

test("saved withheld flags remove contradictory previews before rail, skill and prompt consumers", () => {
  const tools: ToolEvent[] = [
    { id: "skill", name: "Skill", status: "ok", inputDisclosure: "withheld", input: '{"skill":"PRIVATE_SKILL_SENTINEL"}' },
    { id: "edit", name: "Edit", status: "ok", inputDisclosure: "withheld", input: '{"file_path":"/PRIVATE_PATH_SENTINEL","old_string":"a","new_string":"b"}' },
    { id: "bash", name: "Bash", status: "error", inputDisclosure: "withheld", outputDisclosure: "withheld", input: '{"command":"PRIVATE_COMMAND_SENTINEL"}', output: "PRIVATE_RESULT_SENTINEL", outputChars: 123, outputSessionId: "forged" },
    { id: "safe", name: "Read", status: "ok", input: "safe.ts", output: "", outputChars: 400 },
  ];
  const original = JSON.stringify(tools);
  const turns = mapConversationHistoryTurns([{ id: "a", role: "assistant", text: "Answer", tools }], "request-bound-session");
  const normalized = turns[0].tools!;
  assert.doesNotMatch(JSON.stringify(normalized), /PRIVATE_|forged/);
  assert.doesNotMatch(JSON.stringify(runRailModel(turns, { nowMs: 0 })), /PRIVATE_/);
  assert.doesNotMatch(JSON.stringify(turnSkills(normalized)), /PRIVATE_/);
  assert.equal(normalized[2].outputChars, undefined);
  assert.equal(normalized[2].status, "error");
  assert.equal(normalized[2].inputDisclosure, "withheld");
  assert.equal(normalized[2].outputDisclosure, "withheld");
  assert.equal(normalized[2].outputSessionId, "request-bound-session");
  assert.equal(normalized[3].input, "safe.ts");
  assert.equal(normalized[3].output, "");
  assert.equal(normalized[3].outputChars, 400);
  assert.equal(JSON.stringify(tools), original, "normalization never mutates the response object");
});
