// @ts-nocheck
import assert from "node:assert/strict";

const {
  CODE_SHORTCUTS,
  defaultCodeKeymap,
  mergeCodeKeymap,
  codeComboFromEvent,
  bindCodeShortcut,
  codeShortcutForCombo,
  codeComboChips,
  CODE_RESERVED_COMBOS,
} = await import("./code-shortcuts.ts");

const ev = (over) => ({ key: "a", metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...over });

// ── Defaults ─────────────────────────────────────────────────────────────────

// No two actions ship holding the same combo — a factory-default collision
// would silently unbind one of them the first time the map is normalized.
{
  const combos = CODE_SHORTCUTS.map((s) => s.combo);
  assert.equal(new Set(combos).size, combos.length);
}
// No default may collide with the Room's FIXED terminal bindings. Those resolve
// first, inside the terminal, and cannot be rebound — a colliding default would
// be dead on arrival in exactly the pane it was meant for.
{
  const defaults = Object.values(defaultCodeKeymap());
  for (const reserved of CODE_RESERVED_COMBOS) {
    assert.ok(!defaults.includes(reserved), `${reserved} is reserved by the terminal`);
  }
}

// A fresh object each call, so a caller mutating one keymap cannot corrupt the
// defaults for the next.
assert.notEqual(defaultCodeKeymap(), defaultCodeKeymap());
assert.deepEqual(defaultCodeKeymap(), defaultCodeKeymap());

// ── Stored keymaps ───────────────────────────────────────────────────────────

assert.deepEqual(mergeCodeKeymap(null), defaultCodeKeymap());
assert.deepEqual(mergeCodeKeymap("corrupt"), defaultCodeKeymap());
// Unknown ids and non-string values are ignored rather than trusted.
assert.deepEqual(mergeCodeKeymap({ nope: "Mod+Z", help: 7 }), defaultCodeKeymap());
// An empty string is a real value: that is how a binding is UNBOUND, and it has
// to survive a reload or the dialog's unbind does nothing.
assert.equal(mergeCodeKeymap({ help: "" }).help, "");
assert.equal(mergeCodeKeymap({ terminal: "Mod+T" }).terminal, "Mod+T");

// ── Combos from events ───────────────────────────────────────────────────────

// A bare modifier is on the way to a combo, not a combo.
assert.equal(codeComboFromEvent(ev({ key: "Shift", shiftKey: true })), null);
assert.equal(codeComboFromEvent(ev({ key: "Meta", metaKey: true })), null);

assert.equal(codeComboFromEvent(ev({ key: "c", metaKey: true, shiftKey: true })), "Mod+Shift+C");
assert.equal(codeComboFromEvent(ev({ key: "c", ctrlKey: true, shiftKey: true })), "Mod+Shift+C");
assert.equal(codeComboFromEvent(ev({ key: "j", altKey: true })), "Alt+J");
assert.equal(codeComboFromEvent(ev({ key: " ", metaKey: true })), "Mod+Space");
assert.equal(codeComboFromEvent(ev({ key: "Escape" })), "Escape");

// Shift is dropped when it already did its work in the printed character:
// `?` is Shift+/ on a US layout, and storing "Shift+?" would never match again.
assert.equal(codeComboFromEvent(ev({ key: "?", shiftKey: true })), "?");
// It is kept for letters and digits, where the character alone loses it.
assert.equal(codeComboFromEvent(ev({ key: "P", shiftKey: true, metaKey: true })), "Mod+Shift+P");

// ── Rebinding ────────────────────────────────────────────────────────────────

// The frame's stated rule: a duplicate takes the key from the older binding,
// which is then visibly unbound rather than silently shadowed.
{
  const map = bindCodeShortcut(defaultCodeKeymap(), "terminal", "Mod+Shift+C");
  assert.equal(map.terminal, "Mod+Shift+C");
  assert.equal(map.changes, "");
  assert.equal(codeShortcutForCombo(map, "Mod+Shift+C"), "terminal");
}
// Binding never mutates the input.
{
  const before = defaultCodeKeymap();
  const snapshot = { ...before };
  bindCodeShortcut(before, "help", "Mod+K");
  assert.deepEqual(before, snapshot);
}
// Unbinding takes the key from nobody else.
{
  const map = bindCodeShortcut(defaultCodeKeymap(), "help", "");
  assert.equal(map.help, "");
  assert.equal(map.terminal, defaultCodeKeymap().terminal);
  assert.equal(codeShortcutForCombo(map, ""), null);
  assert.equal(codeShortcutForCombo(map, null), null);
}

// ── Display ──────────────────────────────────────────────────────────────────

assert.deepEqual(codeComboChips("Mod+Shift+C", true), ["⌘", "⇧", "C"]);
assert.deepEqual(codeComboChips("Mod+Shift+C", false), ["Ctrl", "Shift", "C"]);
assert.deepEqual(codeComboChips("", true), []);

console.log("code-shortcuts: ok");
