// @ts-nocheck
import assert from "node:assert/strict";
import {
  DEFAULT_PANEL_SHORTCUTS,
  PERSISTED_PANEL_SHORTCUTS_KEY,
  getPanelShortcutBindings,
  labelPanelShortcut,
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

console.log("panel-shortcuts.test.ts: ok");
