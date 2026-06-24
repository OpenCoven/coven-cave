import assert from "node:assert/strict";

import {
  glyphToneClass,
  isTaskSession,
  sessionGlyph,
  stripTaskPrefix,
} from "./session-glyph.ts";

const base = { status: "idle", origin: undefined, title: "Hello" };

// isTaskSession: board origin OR a "Task: " title prefix.
assert.equal(isTaskSession({ origin: "board", title: "anything" }), true);
assert.equal(isTaskSession({ origin: "chat", title: "Task: Ship it" }), true);
assert.equal(isTaskSession({ origin: "chat", title: "task: lowercase" }), true);
assert.equal(isTaskSession({ origin: "chat", title: "Just a chat" }), false);
assert.equal(isTaskSession({ origin: undefined, title: "" }), false);

// stripTaskPrefix: removes the label (case/space tolerant), leaves others alone.
assert.equal(stripTaskPrefix("Task: Review VC"), "Review VC");
assert.equal(stripTaskPrefix("task:   spaced"), "spaced");
assert.equal(stripTaskPrefix("No prefix here"), "No prefix here");

// sessionGlyph precedence: running > failed > task > chat.
assert.deepEqual(sessionGlyph({ ...base, status: "running" }), {
  kind: "running", tone: "accent", icon: "ph:circle-notch-bold", spin: true, label: "Running",
});
assert.equal(sessionGlyph({ ...base, status: "failed" }).kind, "failed");
assert.equal(sessionGlyph({ ...base, status: "error" }).kind, "failed");
assert.equal(sessionGlyph({ ...base, status: "error" }).icon, "ph:warning-circle-fill");
// running wins even for a board task
assert.equal(sessionGlyph({ status: "running", origin: "board", title: "Task: x" }).kind, "running");
// task (no failure/run) → check-square, no spin, calm tone
assert.deepEqual(sessionGlyph({ status: "done", origin: "board", title: "Task: x" }), {
  kind: "task", tone: "muted", icon: "ph:check-square", spin: false, label: "Task",
});
// plain chat → no icon (render the dot)
const chat = sessionGlyph({ ...base, status: "done" });
assert.equal(chat.kind, "chat");
assert.equal(chat.icon, null);

// glyphToneClass maps tones to CSS vars.
assert.match(glyphToneClass("accent"), /accent-presence/);
assert.match(glyphToneClass("danger"), /color-danger/);
assert.match(glyphToneClass("success"), /color-success/);
assert.match(glyphToneClass("muted"), /text-muted/);

console.log("session-glyph.test.ts: ok");
