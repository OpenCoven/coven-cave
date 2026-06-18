// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// The TopBar account button's tooltip advertises "Settings (⌘,)", but the
// shortcut was never wired. workspace.tsx's global keydown handler must handle
// ⌘/Ctrl+, and navigate to /settings.
const workspace = await readFile(new URL("./workspace.tsx", import.meta.url), "utf8");
const topBar = await readFile(new URL("./top-bar.tsx", import.meta.url), "utf8");

// The tooltip that promises the shortcut (the contract this fix honors).
assert.match(topBar, /Settings \(⌘,\)/, "TopBar advertises the ⌘, settings shortcut");

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

console.log("settings-shortcut.test.ts: ok");
