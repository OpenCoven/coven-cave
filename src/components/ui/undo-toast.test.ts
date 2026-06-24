// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./undo-toast.tsx", import.meta.url), "utf8");
const library = readFileSync(new URL("../library-undo-toast.tsx", import.meta.url), "utf8");

// Generic, reusable undo toast: message + icon are props (not hardcoded).
assert.match(src, /export function UndoToast/, "exports UndoToast");
assert.match(src, /message,[\s\S]{0,200}?icon = "ph:trash"/, "message is a prop; icon defaults to trash");
assert.match(src, /undoAriaLabel = "Undo"/, "the Undo button has a configurable accessible label");

// Countdown bar is a single CSS width transition (not a per-frame rAF loop).
assert.doesNotMatch(src, /requestAnimationFrame\(tick\)/, "no per-frame rAF render loop");
assert.match(src, /className="library-undo-toast-progress"/, "renders the countdown progress bar");
assert.match(src, /width: collapsed \? "0%" : "100%", transitionDuration: `\$\{durationMs\}ms`/, "the bar animates 100%→0% over durationMs via CSS");

// autoDismiss is opt-in (off by default) so controller-owned toasts (library)
// keep their behavior while self-dismissing toasts (projects move) opt in.
assert.match(src, /autoDismiss = false/, "autoDismiss defaults to off");
assert.match(src, /autoDismiss\s*\?\s*window\.setTimeout\(\(\) => dismissRef\.current\(\), durationMs\)/, "autoDismiss fires onDismiss via setTimeout (fires even in a backgrounded tab)");

// role=status / aria-live keep it announced.
assert.match(src, /role="status"[\s\S]{0,40}?aria-live="polite"/, "announced politely to assistive tech");

// LibraryUndoToast is now a thin wrapper over the shared primitive (same API).
assert.match(library, /import \{ UndoToast \} from "@\/components\/ui\/undo-toast"/, "LibraryUndoToast delegates to UndoToast");
assert.match(library, /message=\{<>Deleted <strong>\{label\}<\/strong><\/>\}/, "library keeps its 'Deleted <label>' message");
assert.doesNotMatch(library, /autoDismiss/, "library does not self-dismiss (its useUndoDelete controller owns the timer)");

console.log("undo-toast.test.ts: ok");
