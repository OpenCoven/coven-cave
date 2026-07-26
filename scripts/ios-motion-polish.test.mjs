// Pins the iOS motion-polish contracts (cave-9mnx):
//  1. Thread-row → ChatView pushes use the iOS 18 zoom transition, anchored
//     on the row via matchedTransitionSource, and fall back to the standard
//     push under Reduce Motion.
//  2. Queued-offline sends enter subdued (opacity only) instead of the
//     rise-and-scale entrance used for real sends.
// These are source pins because Swift isn't compiled in CI.
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, "apps/ios/CovenCave/CovenCave", p), "utf8");

const chatsHome = read("Views/ChatsHomeView.swift");
const familiarThreads = read("Views/FamiliarThreadsView.swift");
const chatView = read("Views/ChatView.swift");

test("ChatsHomeView owns the zoom namespace and applies the zoom push", () => {
  assert.match(chatsHome, /@Namespace private var zoomNamespace/);
  assert.match(
    chatsHome,
    /navigationTransition\(\.zoom\(sourceID: thread\.id, in: zoomNamespace\)\)/,
  );
});

test("zoom transition is gated on Reduce Motion", () => {
  assert.match(
    chatsHome,
    /if reduceMotion \{\s*ChatView\(thread: thread\)\s*\} else \{/,
    "Reduce Motion must keep the standard push (no navigationTransition)",
  );
});

test("thread rows anchor the zoom via matchedTransitionSource", () => {
  assert.match(
    familiarThreads,
    /ThreadRow\(thread: thread\)\s*\.matchedTransitionSource\(id: thread\.id, in: zoomNamespace\)/,
  );
});

test("queued-offline sends enter subdued (opacity only)", () => {
  assert.match(
    chatView,
    /insertion: message\.isQueued\s*\? \.opacity\s*: \.opacity\.combined\(with: \.scale\(scale: 0\.97, anchor: \.bottom\)\)/,
    "queued sends must skip the rise-and-scale entrance",
  );
});
