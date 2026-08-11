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
  isCodeShortcutTarget,
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
// Ctrl and Cmd both mean Mod REGARDLESS of platform. The stored combo is an
// intent; resolving it to ⌘ or Ctrl happens only at display time. A
// navigator-reading variant of this function was tried and reverted — it makes
// a keymap saved on one platform stop matching on another, and it changes what
// the model returns under a Node runner that exposes navigator.platform.
assert.equal(codeComboFromEvent(ev({ key: "c", ctrlKey: true, shiftKey: true })), "Mod+Shift+C");
assert.equal(codeComboFromEvent(ev({ key: "j", altKey: true })), "Alt+J");
assert.equal(codeComboFromEvent(ev({ key: " ", metaKey: true })), "Mod+Space");
assert.equal(codeComboFromEvent(ev({ key: "Escape" })), "Escape");

// Shift is dropped when it already did its work in the printed character:
// `?` is Shift+/ on a US layout, and storing "Shift+?" would never match again.
assert.equal(codeComboFromEvent(ev({ key: "?", shiftKey: true })), "?");
// It is kept for letters and digits, where the character alone loses it.
assert.equal(codeComboFromEvent(ev({ key: "P", shiftKey: true, metaKey: true })), "Mod+Shift+P");

// ── Who owns a keystroke ─────────────────────────────────────────────────────

const el = (tag, over = {}) => ({
  tagName: tag,
  isContentEditable: false,
  closest: () => null,
  ...over,
});

// Plain surfaces are ours.
assert.equal(isCodeShortcutTarget(el("DIV")), true);
assert.equal(isCodeShortcutTarget(el("BUTTON")), true);
// A missing/odd target must not disable every shortcut.
assert.equal(isCodeShortcutTarget(null), true);
assert.equal(isCodeShortcutTarget({}), true);

// Prose fields are not — a global "?" that ate a question mark mid-sentence
// would be indefensible.
assert.equal(isCodeShortcutTarget(el("INPUT")), false);
assert.equal(isCodeShortcutTarget(el("TEXTAREA")), false);
assert.equal(isCodeShortcutTarget(el("SELECT")), false);
assert.equal(isCodeShortcutTarget(el("DIV", { isContentEditable: true })), false);

// THE TERMINAL CASE. xterm renders a hidden textarea, and the ROOM's own
// terminal-shortcut predicate deliberately calls that "not a typing target" so
// the terminal's ⇧⌘ split bindings resolve. Without this exclusion the room
// would steal Ctrl+P and Ctrl+C from a running shell.
assert.equal(isCodeShortcutTarget(el("TEXTAREA", { closest: (s) => (s === ".xterm" ? {} : null) })), false);
assert.equal(isCodeShortcutTarget(el("DIV", { closest: (s) => (s === ".xterm" ? {} : null) })), false);

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
