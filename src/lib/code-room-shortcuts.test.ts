// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CODE_ROOM_SHORTCUT_HINTS,
  isCodeRoomTypingTarget,
  resolveCodeRoomShortcut,
} from "./code-room-shortcuts.ts";

/** A keypress descriptor with every modifier off unless named. */
function press(key, mods = {}) {
  return {
    key,
    shiftKey: false,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    ...mods,
  };
}

const MOD_SHIFT = { shiftKey: true, metaKey: true };

// ── Every advertised binding resolves ────────────────────────────────────────
{
  const expected = [
    ["ArrowRight", "focus-next-terminal"],
    ["ArrowLeft", "focus-previous-terminal"],
    ["D", "split-right"],
    ["E", "split-down"],
    ["X", "close-terminal"],
    ["B", "toggle-broadcast"],
  ];
  for (const [key, shortcut] of expected) {
    assert.equal(resolveCodeRoomShortcut(press(key, MOD_SHIFT)), shortcut, `⇧⌘${key}`);
    // Layout and caps-lock must not change the answer.
    assert.equal(
      resolveCodeRoomShortcut(press(key.toLowerCase(), MOD_SHIFT)),
      shortcut,
      `⇧⌘${key} lowercased`,
    );
    // Ctrl is the Windows/Linux half of the same binding.
    assert.equal(
      resolveCodeRoomShortcut(press(key, { shiftKey: true, ctrlKey: true })),
      shortcut,
      `⇧⌃${key}`,
    );
  }
  assert.equal(
    Object.keys(CODE_ROOM_SHORTCUT_HINTS).length,
    expected.length,
    "every hint corresponds to a wired binding, and vice versa",
  );
  for (const [, shortcut] of expected) {
    assert.ok(CODE_ROOM_SHORTCUT_HINTS[shortcut], `${shortcut} advertises a hint`);
  }
}

// ── The negatives, which are the point ───────────────────────────────────────
// A Room binding that fires without its modifiers would eat characters out of
// a running shell, so each of these has to stay null.
{
  assert.equal(resolveCodeRoomShortcut(press("d")), null, "a bare letter is shell input");
  assert.equal(
    resolveCodeRoomShortcut(press("d", { ctrlKey: true })),
    null,
    "bare Ctrl is shell signal territory",
  );
  assert.equal(
    resolveCodeRoomShortcut(press("d", { metaKey: true })),
    null,
    "Shift is required, so ⌘D stays free",
  );
  assert.equal(
    resolveCodeRoomShortcut(press("d", { shiftKey: true })),
    null,
    "Shift alone is a capital D",
  );
  assert.equal(
    resolveCodeRoomShortcut(press("d", { ...MOD_SHIFT, altKey: true })),
    null,
    "Alt belongs to the terminal's escape sequences",
  );
  assert.equal(resolveCodeRoomShortcut(press("q", MOD_SHIFT)), null, "an unbound letter");
  assert.equal(resolveCodeRoomShortcut(press("ArrowUp", MOD_SHIFT)), null);
}

// ── The typing guard ─────────────────────────────────────────────────────────
// Only meaningful in a DOM; the resolver half above runs everywhere.
if (typeof document !== "undefined") {
  const input = document.createElement("input");
  assert.equal(isCodeRoomTypingTarget(input), true);
  const textarea = document.createElement("textarea");
  assert.equal(isCodeRoomTypingTarget(textarea), true);

  const editable = document.createElement("div");
  editable.contentEditable = "true";
  assert.equal(isCodeRoomTypingTarget(editable), true);

  const plain = document.createElement("div");
  assert.equal(isCodeRoomTypingTarget(plain), false);
  assert.equal(isCodeRoomTypingTarget(null), false);

  // xterm renders a hidden textarea — treating it as "typing" would disable
  // every Room shortcut exactly where they are supposed to work.
  const term = document.createElement("div");
  term.className = "xterm";
  const helper = document.createElement("textarea");
  term.appendChild(helper);
  assert.equal(isCodeRoomTypingTarget(helper), false, "xterm's helper textarea is not prose");
}

// ── Source contract: the bindings are actually wired ────────────────────────
// The shortcuts sheet was once purged wholesale (cave-7c9i) because its
// "Terminal & panes" group named combos no mounted component handled. A pure
// resolver nothing calls would reproduce exactly that, so pin the consumer.
{
  const workspace = readFileSync(
    new URL("../components/code-terminal-workspace.tsx", import.meta.url),
    "utf8",
  );
  assert.match(workspace, /resolveCodeRoomShortcut\(event\)/, "the workspace resolves keydowns");
  assert.match(
    workspace,
    /isCodeRoomTypingTarget\(event\.target\)/,
    "and refuses to fire from a text field",
  );
  assert.match(workspace, /onKeyDown=\{handleKeyDown\}/, "and the handler is mounted");
  assert.match(
    workspace,
    /case "toggle-broadcast":/,
    "every branch of the union has a case",
  );
  for (const shortcut of Object.keys(CODE_ROOM_SHORTCUT_HINTS)) {
    assert.ok(workspace.includes(`case "${shortcut}"`), `${shortcut} is handled`);
  }

  const sheet = readFileSync(new URL("./keyboard-shortcuts.ts", import.meta.url), "utf8");
  for (const hint of Object.values(CODE_ROOM_SHORTCUT_HINTS)) {
    assert.ok(sheet.includes(hint), `${hint} is advertised in the shortcuts sheet`);
  }
}

// ── Source contract: the room announces what swaps under the cursor ────────
// cave-uod42, carried through the cave-0rcku rebuild: the review rail and the
// terminal drawer both change content without the pointer moving, so a change
// nobody can see must at least be a change somebody hears.
{
  const rail = readFileSync(
    new URL("../components/code-review-rail.tsx", import.meta.url),
    "utf8",
  );
  assert.match(rail, /useAnnouncer\(\)/, "the rail swaps content under a stationary cursor");
  assert.match(rail, /Review rail (shown|hidden)\./, "showing and hiding the rail is announced");

  const drawer = readFileSync(
    new URL("../components/code-terminal-drawer.tsx", import.meta.url),
    "utf8",
  );
  assert.match(drawer, /useAnnouncer\(\)/, "the drawer opens and closes under a stationary cursor");
  assert.match(drawer, /Terminal drawer (open|closed)\./, "the drawer announces both states");
}

console.log("code-room-shortcuts.test.ts ok");
