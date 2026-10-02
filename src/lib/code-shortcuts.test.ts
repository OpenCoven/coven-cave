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
  isCodeShortcutAllowed,
  isCodeShortcutRequired,
  codeRequiredComboHolder,
  codeReservedComboOwner,
  CODE_APP_RESERVED_SHORTCUTS,
  isAppClaimedCombo,
  isCodeReservedCombo,
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
// Reserved combos stay with their fixed owners. Old saved keymaps that tried
// to take one must sanitize back to a valid map rather than double-fire.
assert.equal(mergeCodeKeymap({ prompt: "/" }).prompt, defaultCodeKeymap().prompt);
assert.equal(mergeCodeKeymap({ files: "J" }).files, defaultCodeKeymap().files);
assert.equal(mergeCodeKeymap({ outline: "K" }).outline, defaultCodeKeymap().outline);
assert.equal(mergeCodeKeymap({ terminal: "Shift+A" }).terminal, defaultCodeKeymap().terminal);

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

// ...except the drawer's own toggle (#5729). Without it a focused terminal is a
// keyboard trap: xterm consumes Tab, and the bar's "close" hint went to the shell.
{
  const inXterm = el("TEXTAREA", { closest: (s) => (s === ".xterm" ? {} : null) });
  assert.equal(isCodeShortcutAllowed(inXterm, "terminal"), true, "the toggle leaves a focused terminal");
  for (const action of ["picker", "prompt", "changes", "pr", "files", "outline", "next-file", "previous-file", "help"]) {
    assert.equal(isCodeShortcutAllowed(inXterm, action), false, `${action} still belongs to the shell`);
  }
  // Outside a terminal the old rule holds unchanged.
  assert.equal(isCodeShortcutAllowed(el("DIV"), "picker"), true);
  assert.equal(isCodeShortcutAllowed(el("TEXTAREA"), "terminal"), false, "a prose field never yields, not even the toggle");
  assert.equal(isCodeShortcutAllowed(el("DIV"), null), false, "no bound action, nothing to allow");
}

// ── Rebinding ────────────────────────────────────────────────────────────────

// The frame's stated rule: a duplicate takes the key from the older binding,
// which is then visibly unbound rather than silently shadowed.
{
  const map = bindCodeShortcut(defaultCodeKeymap(), "terminal", "Mod+Shift+C");
  assert.equal(map.terminal, "Mod+Shift+C");
  assert.equal(map.changes, "");
  assert.equal(codeShortcutForCombo(map, "Mod+Shift+C"), "terminal");
}
// Reserved combos are owned by the fixed queue/terminal handlers, never by a
// per-session workbench binding.
{
  const before = defaultCodeKeymap();
  assert.deepEqual(bindCodeShortcut(before, "prompt", "/"), before);
  assert.deepEqual(bindCodeShortcut(before, "files", "J"), before);
  assert.deepEqual(bindCodeShortcut(before, "outline", "K"), before);
  assert.deepEqual(bindCodeShortcut(before, "terminal", "Shift+A"), before);
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

for (const reserved of ["/", "J", "K", "Shift+A"]) {
  assert.ok(CODE_RESERVED_COMBOS.includes(reserved), `${reserved} stays reserved by the queue`);
}

// ── App-wide keys (#5729) ────────────────────────────────────────────────────

// The app's handler runs before the desk's and claims these everywhere, so a
// desk binding on one is dead on arrival. The rule mirrors that handler: with
// Mod it matches the lowercased key, so every Alt/Shift variant of ⌘K, ⌘J and
// ⌘/ is taken; without Mod it takes "?", Alt included (#5737 review).
for (const combo of [
  "?", "Alt+?",
  "Mod+/", "Mod+Alt+/",
  "Mod+K", "Mod+Shift+K", "Mod+Alt+K", "Mod+Alt+Shift+K",
  "Mod+J", "Mod+Shift+J", "Mod+Alt+J", "Mod+Alt+Shift+J",
]) {
  assert.ok(isAppClaimedCombo(combo), `${combo} is the app's`);
  assert.ok(isCodeReservedCombo(combo), `${combo} cannot be bound to the desk`);
  assert.equal(codeReservedComboOwner(combo), "app", `${combo} names the app as its owner`);
  assert.deepEqual(bindCodeShortcut(defaultCodeKeymap(), "help", combo), defaultCodeKeymap(), `binding ${combo} is refused`);
}
// Neighbours the app's handler does not take stay free.
for (const combo of ["Mod+P", "Mod+I", "Mod+Shift+H", "Mod+?", "Alt+K", "Shift+J", "/", ""]) {
  assert.equal(isAppClaimedCombo(combo), false, `${combo || "(unbound)"} is not the app's`);
}
assert.deepEqual(
  CODE_APP_RESERVED_SHORTCUTS.map((shortcut) => shortcut.combo),
  ["Mod+K", "Mod+J", "Mod+/", "?"],
  "the dialog lists each app shortcut once",
);
assert.equal(codeReservedComboOwner("Shift+A"), "session queue");
assert.equal(codeReservedComboOwner("Mod+P"), null);

// The two defaults that sat on app keys moved: the prompt to ⌘I, and help to
// unbound (⌘? is the macOS Help menu). The header button still opens the dialog.
assert.equal(defaultCodeKeymap().prompt, "Mod+I");
assert.equal(defaultCodeKeymap().help, "");
assert.deepEqual(bindCodeShortcut(defaultCodeKeymap(), "help", "?"), defaultCodeKeymap(), "? cannot be bound to the desk");
assert.deepEqual(bindCodeShortcut(defaultCodeKeymap(), "prompt", "Mod+J"), defaultCodeKeymap(), "⌘J cannot be bound to the desk");

// A keymap saved with the old dead defaults loads the new ones rather than
// keeping a binding that can never fire.
{
  const loaded = mergeCodeKeymap({ help: "?", prompt: "Mod+J" });
  assert.equal(loaded.help, "");
  assert.equal(loaded.prompt, "Mod+I");
}
// A free key the person chose for help survives a reload.
assert.equal(mergeCodeKeymap({ help: "Mod+Shift+H" }).help, "Mod+Shift+H");

console.log("code-shortcuts: ok");


// ── The terminal toggle always keeps a key (#5729) ───────────────────────────
// It is the way out of a focused terminal, so it can move but never vanish.
{
  const keymap = defaultCodeKeymap();
  assert.equal(isCodeShortcutRequired("terminal"), true);
  assert.equal(isCodeShortcutRequired("picker"), false);
  assert.deepEqual(bindCodeShortcut(keymap, "terminal", ""), keymap, "unbinding the terminal toggle is refused");
  assert.deepEqual(bindCodeShortcut(keymap, "picker", keymap.terminal), keymap, "another action cannot take the toggle's key");
  assert.equal(codeRequiredComboHolder(keymap, "picker", keymap.terminal), "terminal");
  assert.equal(codeRequiredComboHolder(keymap, "terminal", keymap.terminal), null, "rebinding to its own key is fine");
  const moved = bindCodeShortcut(keymap, "terminal", "Mod+Shift+T");
  assert.equal(moved.terminal, "Mod+Shift+T", "it can still be rebound");
  assert.equal(bindCodeShortcut(moved, "picker", "Mod+\`").picker, "Mod+\`", "its old key is free once it moved");
  assert.equal(mergeCodeKeymap({ terminal: "" }).terminal, defaultCodeKeymap().terminal, "a saved empty binding loads as the default");
  assert.equal(bindCodeShortcut(keymap, "picker", "").picker, "", "ordinary actions can still be unbound");
}
