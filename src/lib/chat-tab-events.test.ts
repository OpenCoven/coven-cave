import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import {
  consumeProjectFocusPending,
  markProjectFocusPending,
} from "./chat-tab-events.ts";

// ── the project-focus latch (PR #5451 review) ────────────────────────────────
// ChatSurface is lazy, and ProjectsView is lazy inside it, so the
// CHAT_FOCUS_PROJECT_EVENT dispatched 60ms after the tab is requested can land
// before either listener exists. The pre-existing tab latch preserves the TAB;
// nothing preserved the destination within it, so a cold load arrived on
// Projects without scrolling to the requested row.

test("a pending project focus survives until something consumes it", () => {
  markProjectFocusPending("/Users/x/code/thing");
  assert.equal(consumeProjectFocusPending(), "/Users/x/code/thing");
});

test("the latch is one-shot, so a later mount cannot re-fire it", () => {
  markProjectFocusPending("/tmp/one");
  assert.equal(consumeProjectFocusPending(), "/tmp/one");
  assert.equal(consumeProjectFocusPending(), null, "a consumed latch is empty");
});

test("a blank root never latches", () => {
  markProjectFocusPending("   ");
  assert.equal(
    consumeProjectFocusPending(),
    null,
    "whitespace is not a destination; latching it would strand a pending focus nothing can satisfy",
  );
});

test("the newest request wins rather than queueing", () => {
  markProjectFocusPending("/tmp/first");
  markProjectFocusPending("/tmp/second");
  assert.equal(consumeProjectFocusPending(), "/tmp/second");
  assert.equal(consumeProjectFocusPending(), null);
});

// ── the consumer ─────────────────────────────────────────────────────────────

const projectsView = await readFile(
  new URL("../components/projects-view.tsx", import.meta.url),
  "utf8",
);

test("ProjectsView waits for its rows before consuming the latch", () => {
  // Consuming on bare mount would discard the root while `projects` is still
  // empty — the same drop, one tick later. `projectsLoading` is the signal that
  // the fetch has settled.
  assert.match(
    projectsView,
    /if \(projectsLoading\) return;[\s\S]{0,200}?consumeProjectFocusPending\(\)/,
    "the latch is consumed only after the project list has loaded",
  );
});

test("a direct event hit clears the latch too", () => {
  // Otherwise an already-mounted surface handles the event and leaves the latch
  // set, and the next Projects mount scrolls somewhere the user never asked for.
  assert.match(
    projectsView,
    /focusProjectRoot\(detail\.root\)\) consumeProjectFocusPending\(\)/,
    "the event path clears the latch so it cannot fire again later",
  );
});
