// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const hook = readFileSync(new URL("./use-undo-delete.ts", import.meta.url), "utf8");
const toast = readFileSync(new URL("../components/ui/undo-toast.tsx", import.meta.url), "utf8");
const shortcuts = readFileSync(new URL("./keyboard-shortcuts.ts", import.meta.url), "utf8");

// The hook binds ⌘Z / Ctrl+Z to undo while a delete is pending.
assert.match(hook, /window\.addEventListener\("keydown"/, "useUndoDelete listens for keydown while pending");
assert.match(hook, /e\.metaKey \|\| e\.ctrlKey/, "undo triggers on ⌘ or Ctrl");
assert.match(hook, /e\.key !== "z" && e\.key !== "Z"/, "undo binds to the Z key");
// ⌘⇧Z (redo) and Alt-modified combos are explicitly left alone.
assert.match(hook, /e\.shiftKey \|\| e\.altKey/, "⌘⇧Z / Alt combos are not hijacked");
// Native text undo in editable fields is respected.
assert.match(hook, /INPUT\|TEXTAREA\|SELECT/, "defers to native undo in editable fields");
assert.match(hook, /isContentEditable/, "defers to native undo in contenteditable");
// The effect is scoped to a pending entry (handler attaches/detaches with it).
assert.match(hook, /useEffect\(\(\) => \{\s*if \(!pending\) return;/, "the keydown handler is active only while a delete is pending");

// The toast advertises ⌘Z.
assert.match(toast, /library-undo-toast-kbd[\s\S]{0,40}⌘Z/, "the undo toast shows a ⌘Z hint");

// The shortcuts sheet documents it.
assert.match(shortcuts, /keys: "⌘Z", description: "Undo the last delete/, "⌘Z is in the shortcuts catalog");

console.log("use-undo-delete-keyboard.test.ts OK");
