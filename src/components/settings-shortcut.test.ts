// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { platformizeHint } from "../lib/platform-keys.ts";

// The desktop shell promises cross-platform shortcuts. Pin both the shell
// wiring and the Windows/Linux rendering so no host quietly falls back to
// macOS-only glyphs.
const workspace = await readFile(new URL("./workspace.tsx", import.meta.url), "utf8");
const topBar = await readFile(new URL("./top-bar.tsx", import.meta.url), "utf8");
const familiarMenuBar = await readFile(new URL("./familiar-menu-bar.tsx", import.meta.url), "utf8");

// Source contracts: the shell chrome calls through the platformizer for each
// hard-coded hint it owns.
assert.match(
  topBar,
  /platformizeHint\("⌘K", keys\)/,
  "TopBar platformizes the Search shortcut hint",
);
assert.match(
  topBar,
  /platformizeHint\("⌘B", keys\)/,
  "TopBar platformizes the sidebar toggle shortcut hint",
);
assert.match(
  topBar,
  /platformizeHint\("⌘\\\\", keys\)/,
  "TopBar platformizes the list-panel shortcut hint",
);
assert.match(
  topBar,
  /platformizeHint\("⌘J", keys\)/,
  "TopBar platformizes the New chat shortcut hint",
);
assert.match(
  topBar,
  /platformizeHint\("⌘,", keys\)/,
  "TopBar platformizes the Settings shortcut hint",
);
assert.match(
  familiarMenuBar,
  /platformizeHint\("⌘K", keys\)/,
  "FamiliarMenuBar platformizes the Search shortcut hint",
);
// The desktop menu bar's New chat button was removed in cave-l9slw, so it no
// longer renders a ⌘J hint to platformize. TopBar above still does — it keeps
// its own New chat trigger — and ⌘J itself is unchanged as a global shortcut.
assert.doesNotMatch(
  familiarMenuBar,
  /platformizeHint\("⌘J", keys\)/,
  "FamiliarMenuBar has no New chat hint left to platformize",
);
assert.match(
  familiarMenuBar,
  /platformizeHint\("⌘,", keys\)/,
  "FamiliarMenuBar platformizes the Settings shortcut hint",
);

// ⌘/Ctrl+, is handled in the global keydown handler and opens settings.
assert.match(
  workspace,
  /e\.key === ","\s*\)\s*\{[\s\S]*?nextRouter\.push\("\/settings"\)/,
  "workspace handles meta/ctrl + ',' by navigating to /settings",
);
// It's gated to the meta/ctrl path (not a bare comma), matching ⌘1..⌘9 / ⌘0.
assert.match(
  workspace,
  /meta && !alt && e\.key === ","/,
  "the ',' shortcut requires the meta/ctrl modifier",
);

const pcKeys = {
  mod: "Ctrl",
  alt: "Alt",
  shift: "Shift",
  ctrl: "Ctrl",
  enter: "Enter",
  up: "↑",
  down: "↓",
};

assert.deepEqual(
  {
    search: platformizeHint("⌘K", pcKeys),
    sidebar: platformizeHint("⌘B", pcKeys),
    list: platformizeHint("⌘\\", pcKeys),
    newChat: platformizeHint("⌘J", pcKeys),
    settings: platformizeHint("⌘,", pcKeys),
  },
  {
    search: "CtrlK",
    sidebar: "CtrlB",
    list: "Ctrl\\",
    newChat: "CtrlJ",
    settings: "Ctrl,",
  },
  "desktop shell shortcut hints should render Ctrl-based labels off macOS",
);

console.log("settings-shortcut.test.ts: ok");
