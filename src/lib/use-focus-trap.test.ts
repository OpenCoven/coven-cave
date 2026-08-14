// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("./use-focus-trap.ts", import.meta.url),
  "utf8",
);

// Exports the hook.
assert.match(
  source,
  /export function useFocusTrap\s*\(/,
  "hook exports useFocusTrap(...)",
);

// Saves and restores prior focus.
assert.match(source, /document\.activeElement/, "captures document.activeElement on activate");
assert.match(
  source,
  /returnFocusRef\.current\?\.focus\(\)/,
  "restores focus on deactivate",
);

// Listens for Tab and Escape.
assert.match(source, /e\.key === "Tab"/, "intercepts Tab to cycle within container");
assert.match(source, /e\.key === "Escape"/, "intercepts Escape (caller decides what to do)");

// Queries focusables (re-queries on each Tab — DOM may change).
assert.match(
  source,
  /querySelectorAll<HTMLElement>\(FOCUSABLE\)/,
  "re-queries focusables on each Tab event",
);

// Exports the shared FOCUSABLE selector for consumers who want to use it directly.
assert.match(source, /export const FOCUSABLE\s*=/, "exports FOCUSABLE selector constant");

// Stable callback handling: onEscape must be stored in a ref so the effect
// doesn't tear down and re-run (and clobber returnFocusRef) when the caller
// passes an inline arrow.
assert.match(
  source,
  /onEscapeRef\s*=\s*useRef/,
  "stores onEscape in a ref to avoid effect re-runs on callback identity change",
);

// Escape dismissal is optional: the handler must optional-chain the ref so an
// undefined onEscape is a safe no-op. Callers (Modal's dismissOnEscape gate,
// cave-0g9u) rely on this to block Esc dismissal mid-submit while the trap —
// Tab cycling and focus return — stays active.
assert.match(
  source,
  /onEscapeRef\.current\?\.\(\)/,
  "an undefined onEscape no-ops on Esc without deactivating the trap",
);

// onEscape must NOT appear in the trap effect's dep array.
const trapEffect = source.match(/useEffect\(\s*\(\)\s*=>\s*\{[\s\S]*?\},\s*\[([^\]]*)\]\s*\)/g) ?? [];
const trapDeps = trapEffect.find((b) => b.includes('e.key === "Tab"')) ?? "";
assert.doesNotMatch(
  trapDeps,
  /\bonEscape\b/,
  "trap effect deps must not include onEscape (use a ref instead)",
);

// Fallback: focus the container itself if it has no focusable child.
assert.match(
  source,
  /container\.focus\(\)/,
  "trap focuses the container as a fallback when no focusable child exists",
);

// --- Stack-awareness (cave-rl980 Task 5 modal/focus findings) ---
//
// Every active trap registers on a shared module-level stack so a
// body-portaled child dialog opened above another active trap (e.g. an
// artifact fullscreen viewer opened from inside the right-Chat drawer's
// transcript) can layer correctly: only the TOPMOST trap owns Escape and Tab
// containment; a background trap "resumes" the instant the trap above it
// deactivates, with no extra bookkeeping.

// A module-level stack, not per-hook-instance state — this is what lets
// unrelated hook instances coordinate ordering at all.
assert.match(
  source,
  /const trapStack:\s*TrapEntry\[\]\s*=\s*\[\];/,
  "a module-level stack tracks every currently-active trap",
);

// Stable per-hook-instance identity (not object identity) survives a
// StrictMode mount→cleanup→mount cycle without duplicating or losing the
// registration.
assert.match(
  source,
  /const idRef = useRef\(0\);/,
  "each hook instance gets a stable id ref",
);
assert.match(
  source,
  /if \(idRef\.current === 0\) idRef\.current = nextTrapId\+\+;/,
  "the id is assigned once via lazy ref init, not re-created on every render",
);

// register/unregister are id-keyed and defensively de-duplicate, so a
// StrictMode double-invoke (register → unregister → register) can never
// leave two entries for the same logical trap.
assert.match(
  source,
  /function registerTrap\(id: number\): void \{/,
  "registerTrap is keyed by the stable id",
);
assert.match(
  source,
  /const stale = trapStack\.findIndex\(\(entry\) => entry\.id === id\);\s*\n\s*if \(stale !== -1\) trapStack\.splice\(stale, 1\);/,
  "registerTrap removes any stale entry for the same id before pushing (StrictMode safety)",
);
assert.match(
  source,
  /function unregisterTrap\(id: number\): \{ hadTrapAbove: boolean \} \{/,
  "unregisterTrap is keyed by the stable id, not stack position",
);
assert.match(
  source,
  /function isTopmostTrap\(id: number\): boolean \{/,
  "isTopmostTrap checks the id against the top of the stack",
);

// Only the topmost trap acts on a keydown — everything below it is a
// complete no-op.
assert.match(
  source,
  /function onKey\(e: KeyboardEvent\) \{\s*\n(?:\s*\/\/[^\n]*\n)*\s*if \(!isTopmostTrap\(trapId\)\) return;/,
  "the keydown handler is gated on being the topmost trap before touching Escape or Tab",
);

// Deactivating skips its own focus restore when a still-active nested trap
// sits above it (ancestor-closes-under-open-child safety), deferring to that
// trap's own eventual restoration instead of fighting its containment.
assert.match(
  source,
  /const \{ hadTrapAbove \} = unregisterTrap\(trapId\);/,
  "cleanup captures whether a trap was layered above before restoring focus",
);
assert.match(
  source,
  /if \(!hadTrapAbove\) \{\s*\n\s*returnFocusRef\.current\?\.focus\(\);\s*\n\s*\}/,
  "focus restoration on deactivate is skipped while a nested trap is still active above it",
);

// Test seam: a stray trap left registered by a failed test must not leak
// into a later one in the same file/process.
assert.match(
  source,
  /export function resetFocusTrapStackForTest\(\): void \{/,
  "exports a test-only stack reset",
);

// --- Owner-hidden auto-dismiss (cave-rl980 Task 5 finding #2) ---
//
// An ancestor "modal owner" (e.g. RightChatPanel) that stays mounted but
// becomes hidden/inert must be able to ask a still-active, body-portaled
// descendant trap to close — since createPortal moves the dialog's DOM node
// outside the owner's subtree, the owner's own `inert` never reaches it, but
// React context still does regardless of portal target.
assert.match(
  source,
  /export const FocusTrapOwnerHiddenContext = createContext\(false\);/,
  "exports a context ancestors use to signal they've become hidden, defaulting to false (unaffected) everywhere it isn't provided",
);
assert.match(
  source,
  /const ownerHidden = useContext\(FocusTrapOwnerHiddenContext\);/,
  "the hook consumes the owner-hidden context automatically",
);
assert.match(
  source,
  /if \(!active \|\| !ownerHidden\) return;\s*\n\s*onEscapeRef\.current\?\.\(\);/,
  "an active trap whose owner becomes hidden is asked to close through the SAME onEscape callback Escape uses",
);

console.log("use-focus-trap.test.ts OK");
