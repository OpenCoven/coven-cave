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
