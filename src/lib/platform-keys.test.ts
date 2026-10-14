import assert from "node:assert/strict";
import { test } from "node:test";
import { platformizeHint, type KeySymbols } from "./platform-keys.ts";

// Shortcut hints are authored once with Mac glyphs and retargeted at render.
// Off macOS the labels are words, so they need a separator: "Ctrl+Shift+A",
// never "CtrlShiftA" (#5970).

const MAC: KeySymbols = { mod: "⌘", alt: "⌥", shift: "⇧", ctrl: "⌃", enter: "↵", up: "↑", down: "↓" };
const PC: KeySymbols = { mod: "Ctrl", alt: "Alt", shift: "Shift", ctrl: "Ctrl", enter: "Enter", up: "↑", down: "↓" };

test("Mac glyphs render unchanged", () => {
  for (const hint of ["⌘K", "⌘⇧A", "⌥↵", "⌘\\", "⌥↑ / ⌥↓", "⌃C"]) {
    assert.equal(platformizeHint(hint, MAC), hint);
  }
});

test("Windows and Linux labels join modifiers with +", () => {
  assert.deepEqual(
    {
      single: platformizeHint("⌘K", PC),
      chord: platformizeHint("⌘⇧A", PC),
      enter: platformizeHint("⌘↵", PC),
      slash: platformizeHint("⌘\\", PC),
      control: platformizeHint("⌃C", PC),
      alt: platformizeHint("⌥Z", PC),
      pair: platformizeHint("⌥↑ / ⌥↓", PC),
      comma: platformizeHint("⌘,", PC),
      lone: platformizeHint("⌘", PC),
    },
    {
      single: "Ctrl+K",
      chord: "Ctrl+Shift+A",
      enter: "Ctrl+Enter",
      slash: "Ctrl+\\",
      control: "Ctrl+C",
      alt: "Alt+Z",
      pair: "Alt+↑ / Alt+↓",
      comma: "Ctrl+,",
      lone: "Ctrl",
    },
  );
});

test("plain keys and punctuation are left alone", () => {
  for (const hint of ["Esc", "?", "/", "↑↓", "Shift+Enter"]) {
    assert.equal(platformizeHint(hint, PC), hint);
  }
});
