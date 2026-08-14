import assert from "node:assert/strict";
import test from "node:test";

import { covenComposerRouting } from "./coven-composer-routing.ts";

const TRIO = [
  { id: "cody", name: "Cody" },
  { id: "echo", name: "Echo" },
  { id: "kitty", name: "Kitty" },
];

test("round robin names the selected order, never a bare count", () => {
  const routing = covenComposerRouting({ mode: "round-robin", members: TRIO, running: false });
  assert.equal(routing.placeholder, "Send to Cody, then Echo, then Kitty…");
  assert.equal(routing.lead, "Sends in turn to");
  assert.deepEqual(routing.chips.map((c) => c.arrow), [false, true, true]);
  assert.deepEqual(routing.chips.map((c) => c.dot), [false, false, false]);
});

test("a broadcast reads as an unordered set", () => {
  const routing = covenComposerRouting({ mode: "broadcast", members: TRIO, running: false });
  assert.equal(routing.placeholder, "Broadcast to Cody, Echo, and Kitty…");
  assert.equal(routing.lead, "Broadcasts to");
  assert.deepEqual(routing.chips.map((c) => c.dot), [false, true, true]);
  assert.deepEqual(routing.chips.map((c) => c.arrow), [false, false, false]);
});

test("Enter queues during a run and the button says so", () => {
  const routing = covenComposerRouting({ mode: "round-robin", members: TRIO, running: true });
  assert.equal(routing.queues, true);
  assert.equal(routing.sendLabel, "Queue");
  assert.equal(routing.placeholder, "Message the coven — held until this run finishes…");
  assert.equal(routing.lead, "Next message: in turn to");
  assert.match(routing.enterNote, /Enter queues your message; it won't interrupt anyone/);
});

test("an @mention routes to one familiar and says the selected order holds", () => {
  const routing = covenComposerRouting({
    mode: "round-robin",
    members: TRIO,
    mentioned: [{ id: "echo", name: "Echo" }],
    running: false,
  });
  assert.equal(routing.lead, "Replies only to");
  assert.deepEqual(routing.chips.map((c) => c.name), ["Echo"]);
  assert.equal(routing.placeholder, "Reply to Echo…");
  assert.equal(routing.sendLabel, "Send to Echo");
  assert.match(routing.enterNote, /the selected order stays unchanged/);
});

test("a coven of one is just a chat — no mode control", () => {
  const routing = covenComposerRouting({
    mode: "round-robin",
    members: [{ id: "kitty", name: "Kitty" }],
    running: false,
  });
  assert.equal(routing.showModeControl, false);
  assert.equal(routing.placeholder, "Message Kitty…");
  assert.equal(routing.lead, "Sends to");
  assert.equal(routing.enterNote, "Enter sends · Shift+Enter new line.");
});

test("an empty coven states what unlocks the composer", () => {
  const routing = covenComposerRouting({ mode: "broadcast", members: [], running: false });
  assert.equal(routing.placeholder, "Add familiars to this coven first…");
  assert.equal(routing.enterNote, "The composer unlocks once the coven has members.");
  assert.deepEqual(routing.chips, []);
  assert.equal(routing.showModeControl, false);
});

test("every placeholder uses the ellipsis character, per the copy contract", () => {
  for (const running of [false, true]) {
    for (const mode of ["round-robin", "broadcast"] as const) {
      const routing = covenComposerRouting({ mode, members: TRIO, running });
      assert.ok(routing.placeholder.endsWith("…"), routing.placeholder);
      assert.ok(!routing.placeholder.includes("..."), routing.placeholder);
    }
  }
});
