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

console.log("use-focus-trap.test.ts OK");
