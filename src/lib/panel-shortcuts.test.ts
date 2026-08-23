// @ts-nocheck
import assert from "node:assert/strict";
import {
  DEFAULT_PANEL_SHORTCUTS,
  PERSISTED_PANEL_SHORTCUTS_KEY,
  getPanelShortcutBindings,
  labelPanelShortcut,
  eventKey,
  matchesPanelShortcut,
} from "./panel-shortcuts.ts";

function keyEvent(init: {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}) {
  return {
    key: init.key,
    metaKey: Boolean(init.metaKey),
    ctrlKey: Boolean(init.ctrlKey),
    shiftKey: Boolean(init.shiftKey),
    altKey: Boolean(init.altKey),
  } as KeyboardEvent;
}

assert.deepEqual(DEFAULT_PANEL_SHORTCUTS.toggleLeftPanel, {
  key: "b",
  primary: true,
  shift: false,
  alt: false,
});
assert.deepEqual(DEFAULT_PANEL_SHORTCUTS.toggleRightPanel, {
  key: "b",
  primary: true,
  shift: true,
  alt: false,
});

assert.equal(matchesPanelShortcut(keyEvent({ key: "b", metaKey: true }), DEFAULT_PANEL_SHORTCUTS.toggleLeftPanel), true);
assert.equal(matchesPanelShortcut(keyEvent({ key: "b", ctrlKey: true }), DEFAULT_PANEL_SHORTCUTS.toggleLeftPanel), true);
assert.equal(matchesPanelShortcut(keyEvent({ key: "B", metaKey: true, shiftKey: true }), DEFAULT_PANEL_SHORTCUTS.toggleLeftPanel), false);
assert.equal(matchesPanelShortcut(keyEvent({ key: "B", metaKey: true, shiftKey: true }), DEFAULT_PANEL_SHORTCUTS.toggleRightPanel), true);
assert.equal(matchesPanelShortcut(keyEvent({ key: "b", metaKey: true }), DEFAULT_PANEL_SHORTCUTS.toggleRightPanel), false);

const custom = getPanelShortcutBindings({
  toggleRightPanel: { key: "]", primary: true, shift: false, alt: false },
});
assert.equal(matchesPanelShortcut(keyEvent({ key: "]", metaKey: true }), custom.toggleRightPanel), true);
assert.equal(matchesPanelShortcut(keyEvent({ key: "B", metaKey: true, shiftKey: true }), custom.toggleRightPanel), false);
assert.equal(labelPanelShortcut(DEFAULT_PANEL_SHORTCUTS.toggleLeftPanel), "⌘B");
assert.equal(labelPanelShortcut(DEFAULT_PANEL_SHORTCUTS.toggleRightPanel), "⌘⇧B");

const priorWindow = globalThis.window;
Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: {
    localStorage: {
      getItem(key: string) {
        if (key !== PERSISTED_PANEL_SHORTCUTS_KEY) return null;
        return JSON.stringify({
          toggleLeftPanel: { key: "[", primary: true, shift: false, alt: false },
        });
      },
    },
  },
});
const persisted = getPanelShortcutBindings();
assert.equal(matchesPanelShortcut(keyEvent({ key: "[", metaKey: true }), persisted.toggleLeftPanel), true);
assert.equal(matchesPanelShortcut(keyEvent({ key: "b", metaKey: true }), persisted.toggleLeftPanel), false);
Object.defineProperty(globalThis, "window", { configurable: true, value: priorWindow });

// An event with no readable key must MATCH NOTHING rather than throw.
//
// KeyboardEvent.key is typed as a string but is absent whenever the event is
// not really a keyboard event — a synthetic new Event("keydown") from a
// password manager or extension, or an IME/composition path. The reported
// crash (cave-lryhx) took out the shell's whole keydown handler, so ONE
// malformed event disabled every panel shortcut until reload.
{
  const keyless = { metaKey: true, ctrlKey: false, shiftKey: false, altKey: false };
  assert.equal(eventKey(keyless), null, "a missing key reads as null, not a crash");
  assert.doesNotThrow(
    () => matchesPanelShortcut(keyless, DEFAULT_PANEL_SHORTCUTS.toggleLeftPanel),
    "an event with no key must not throw",
  );
  assert.equal(
    matchesPanelShortcut(keyless, DEFAULT_PANEL_SHORTCUTS.toggleLeftPanel),
    false,
    "an unreadable event matches no shortcut",
  );
}

// The same property, but driven through a REAL dispatched event rather than an
// object literal — the literals above describe the shape we THINK an extension
// sends, while this reproduces the shape that actually crashed: an event
// dispatched as "keydown" but constructed as a plain Event, so `key` is not
// merely undefined, it is absent from the object entirely.
//
// This also covers the SURVIVAL property the crash was really about. The
// handler below is the shell's shape in miniature: two matchesPanelShortcut
// calls followed by a direct read of the key. A bad event must leave it able
// to serve the next good one.
{
  // A well-formed keydown: every modifier present as a boolean, the way a real
  // KeyboardEvent reports them. The malformed events below deliberately omit
  // them, which is exactly what makes them malformed.
  const goodEvent = (key, mods = {}) =>
    Object.assign(new Event("keydown"), {
      key,
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      ...mods,
    });

  const served = [];
  let escaped = null;
  const target = new EventTarget();
  target.addEventListener("keydown", (e) => {
    try {
      if (matchesPanelShortcut(e, DEFAULT_PANEL_SHORTCUTS.toggleRightPanel)) {
        served.push("right");
        return;
      }
      if (matchesPanelShortcut(e, DEFAULT_PANEL_SHORTCUTS.toggleLeftPanel)) {
        served.push("left");
        return;
      }
      // The second reported site: shell.tsx reads the key directly here.
      const key = eventKey(e);
      if (key === null) return;
      if ((e.metaKey || e.ctrlKey) && key === "\\") served.push("list");
    } catch (err) {
      escaped = err;
    }
  });

  const bare = new Event("keydown");
  assert.equal("key" in bare, false, "the reported shape carries no key at all");
  target.dispatchEvent(bare);
  assert.equal(escaped, null, "a bare Event must not throw out of the handler");
  assert.deepEqual(served, [], "an unreadable event serves no shortcut");

  // Modifiers present, key absent — the shape that reaches a site sitting
  // behind a `metaKey` test, which is every other member of the family.
  target.dispatchEvent(Object.assign(new Event("keydown"), { metaKey: true }));
  assert.equal(escaped, null, "modifiers-without-key must not throw either");
  assert.deepEqual(served, [], "still no shortcut served");

  // ...and now a GOOD shortcut, after the bad ones. This is the user-visible
  // property: asserting "did not throw" alone would still pass if the guard
  // had disabled the shortcuts it protects.
  target.dispatchEvent(goodEvent("b", { metaKey: true }));
  assert.equal(escaped, null);
  assert.deepEqual(served, ["left"], "a real shortcut still fires after a bad event");

  target.dispatchEvent(goodEvent("B", { metaKey: true, shiftKey: true }));
  assert.deepEqual(served, ["left", "right"], "and the next one after that");

  target.dispatchEvent(goodEvent("\\", { metaKey: true }));
  assert.deepEqual(
    served,
    ["left", "right", "list"],
    "the direct-key site downstream of the guard still serves its shortcut",
  );
}

// The same for a key that is present but not a string, which is what a
// hand-rolled synthetic event tends to produce.
for (const bad of [null, undefined, 42, {}]) {
  const event = { key: bad, metaKey: true, ctrlKey: false, shiftKey: false, altKey: false };
  assert.equal(eventKey(event), null, `key=${String(bad)} reads as null`);
  assert.doesNotThrow(() => matchesPanelShortcut(event, DEFAULT_PANEL_SHORTCUTS.toggleLeftPanel));
}

// A real event still matches, so the guard did not simply disable matching.
assert.equal(
  matchesPanelShortcut(keyEvent({ key: "b", metaKey: true }), DEFAULT_PANEL_SHORTCUTS.toggleLeftPanel),
  true,
  "the guard must not break the shortcut it protects",
);

console.log("panel-shortcuts.test.ts: ok");
