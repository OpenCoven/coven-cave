import assert from "node:assert/strict";
import {
  openTaskWorkOnBoard,
  resetTaskWorkHandoffForTest,
  takeTaskWorkHandoff,
  taskWorkCardIdFromHash,
  taskWorkHandoffFrom,
} from "./task-work-handoff.ts";

// Only a native reservation that still owes its first prompt hands off.
assert.equal(taskWorkHandoffFrom("c1", null), null);
assert.equal(taskWorkHandoffFrom("c1", { sessionId: "s1" }), null, "a daemon session or a sent prompt opens directly");
assert.equal(taskWorkHandoffFrom("c1", { sessionId: "s1", bridge: "native-chat" }), null, "no prompt, nothing to hand off");
assert.equal(taskWorkHandoffFrom("c1", { sessionId: "s1", bridge: "native-chat", initialPrompt: "   " }), null);
assert.equal(taskWorkHandoffFrom("c1", { bridge: "native-chat", initialPrompt: "Do it" }), null, "no session, nothing to open");
assert.deepEqual(
  taskWorkHandoffFrom("c1", { sessionId: "s1", bridge: "native-chat", initialPrompt: "Do it", initialModelOverride: "opus" }),
  { cardId: "c1", sessionId: "s1", initialPrompt: "Do it", initialModelOverride: "opus" },
);
assert.deepEqual(
  taskWorkHandoffFrom("c1", { sessionId: "s1", bridge: "native-chat", initialPrompt: "Do it", initialModelOverride: 7 }),
  { cardId: "c1", sessionId: "s1", initialPrompt: "Do it" },
);

assert.deepEqual(
  taskWorkHandoffFrom("c1", { sessionId: "s1", bridge: "native-chat", initialPrompt: "Do it", card: { id: "c1", sessionId: "s1", title: "T" } }),
  { cardId: "c1", sessionId: "s1", initialPrompt: "Do it", card: { id: "c1", sessionId: "s1", title: "T" } },
  "the reserved card rides along so the Board needn't wait for a reload",
);
assert.equal(
  taskWorkHandoffFrom("c1", { sessionId: "s1", bridge: "native-chat", initialPrompt: "Do it", card: { id: "c1", sessionId: "s0" } })?.card,
  undefined,
  "a card that doesn't record this session is not trusted",
);

// Hash parsing.
assert.equal(taskWorkCardIdFromHash(""), null);
assert.equal(taskWorkCardIdFromHash("#card-c1"), null, "the inspector's card hash is not a work hash");
assert.equal(taskWorkCardIdFromHash("#work-"), null);
assert.equal(taskWorkCardIdFromHash("#work-c%201"), "c 1");
assert.equal(taskWorkCardIdFromHash("#work-%E0%A4%A"), null, "a malformed escape is ignored");

// Open: switch to the Board, then name the task; the prompt waits once.
const events: string[] = [];
const location = { hash: "" };
(globalThis as Record<string, unknown>).window = {
  location,
  dispatchEvent: (event: CustomEvent) => {
    events.push(`${event.type}:${(event.detail as { mode?: string }).mode}:${location.hash}`);
    return true;
  },
};
(globalThis as Record<string, unknown>).CustomEvent ??= class<T> extends Event {
  detail: T;
  constructor(type: string, init: { detail: T }) {
    super(type);
    this.detail = init.detail;
  }
};

resetTaskWorkHandoffForTest();
openTaskWorkOnBoard({ cardId: "c 1", sessionId: "s1", initialPrompt: "Do it" });
assert.deepEqual(events, ["cave:navigate-mode:board:"], "the mode switch comes before the hash, like focus-card");
assert.equal(location.hash, "work-c%201");
assert.equal(takeTaskWorkHandoff("other"), null, "another task can't take it");
assert.deepEqual(takeTaskWorkHandoff("c 1"), { cardId: "c 1", sessionId: "s1", initialPrompt: "Do it" });
assert.equal(takeTaskWorkHandoff("c 1"), null, "a prompt is handed off once");

console.log("task-work-handoff: ok");
