import assert from "node:assert/strict";
import test from "node:test";

import {
  buildResearchChatRunInput,
  formatResearchRunStarted,
  RESEARCH_CHAT_COMMAND_HELP,
} from "./research-chat-command.ts";
import { inferResearchMissionMode } from "./research-mission-routing.ts";
import {
  RESEARCH_INTENT_MIN_LENGTH,
  validateCreateResearchMissionInput,
  type ResearchMission,
} from "./research-missions.ts";

test("a chat-invoked run records the conversation it was invoked from", () => {
  const built = buildResearchChatRunInput({
    familiarId: "nova",
    sessionId: "conv-42",
    intent: "  compare managed vector stores for a small team  ",
  });
  assert.equal(built.ok, true);
  if (!built.ok) return;
  // The origin is what lets the Research Desk project this run back into THIS
  // conversation. A run that only knew "chat" would have nowhere to return to.
  assert.deepEqual(built.input.origin, { surface: "chat", sessionId: "conv-42" });
  assert.equal(built.input.familiarId, "nova");
  assert.equal(built.input.intent, "compare managed vector stores for a small team");
});

test("chat routes an intent through the shared router, not a chat-local one", () => {
  // Both surfaces must read the same sentence the same way; a private chat
  // router would be a second source of truth wearing one run's name.
  for (const intent of [
    "compare two managed vector stores",
    "landscape of open source vector databases",
    "write a paper on retrieval evaluation",
    "keep researching until the benchmark stabilises",
  ]) {
    const built = buildResearchChatRunInput({ familiarId: "nova", sessionId: "c1", intent });
    assert.equal(built.ok, true);
    if (!built.ok) continue;
    assert.equal(built.input.mode, inferResearchMissionMode(intent).mode);
    assert.equal(built.input.modeSource, "auto");
  }
});

test("the request chat builds is accepted verbatim by the shared create contract", () => {
  // The point of the slice: chat does not get its own creation path. Whatever
  // chat builds must clear the same server validator the Research Desk's
  // intake clears, with its origin surviving the crossing.
  const built = buildResearchChatRunInput({
    familiarId: "nova",
    sessionId: "conv-42",
    intent: "compare managed vector stores for a small team",
  });
  assert.equal(built.ok, true);
  if (!built.ok) return;
  const validated = validateCreateResearchMissionInput(built.input);
  assert.equal(validated.ok, true);
  if (!validated.ok) return;
  assert.deepEqual(validated.value.origin, { surface: "chat", sessionId: "conv-42" });
});

test("a run with no conversation to return to claims no conversation", () => {
  const built = buildResearchChatRunInput({
    familiarId: "nova",
    sessionId: "   ",
    intent: "compare managed vector stores for a small team",
  });
  assert.equal(built.ok, true);
  if (!built.ok) return;
  // Recording a fabricated or blank session id would give the desk a jump
  // target that opens a conversation the user was never in.
  assert.deepEqual(built.input.origin, { surface: "chat" });
  assert.equal(validateCreateResearchMissionInput(built.input).ok, true);
});

test("a too-short brief is refused in chat's own words, and starts nothing", () => {
  const empty = buildResearchChatRunInput({ familiarId: "nova", sessionId: "c1", intent: "   " });
  assert.equal(empty.ok, false);
  assert.equal(empty.ok === false && empty.message, RESEARCH_CHAT_COMMAND_HELP);

  const short = buildResearchChatRunInput({
    familiarId: "nova",
    sessionId: "c1",
    intent: "x".repeat(RESEARCH_INTENT_MIN_LENGTH - 1),
  });
  assert.equal(short.ok, false);
  assert.equal(short.ok === false && short.message.includes(String(RESEARCH_INTENT_MIN_LENGTH)), true);

  // The boundary itself is accepted — the gate is the shared minimum, not a
  // stricter chat-local one.
  const atMinimum = buildResearchChatRunInput({
    familiarId: "nova",
    sessionId: "c1",
    intent: "x".repeat(RESEARCH_INTENT_MIN_LENGTH),
  });
  assert.equal(atMinimum.ok, true);
});

test("chat's confirmation names the durable run rather than a chat-local card", () => {
  const mission = {
    title: "Vector store comparison",
    mode: "brief",
  } as unknown as ResearchMission;
  const message = formatResearchRunStarted(mission);
  assert.equal(message.includes("Vector store comparison"), true);
  assert.equal(message.includes("Research Desk"), true);
});
