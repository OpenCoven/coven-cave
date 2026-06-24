// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("./use-prefers-reduced-motion.ts", import.meta.url),
  "utf8",
);

// Hook is named and exported.
assert.match(
  source,
  /export function usePrefersReducedMotion\(\)\s*:\s*boolean/,
  "hook exports usePrefersReducedMotion() returning boolean",
);

// SSR-safe: must guard window before matchMedia.
assert.match(
  source,
  /typeof window === "undefined"/,
  "hook must guard typeof window for SSR safety",
);

// Reads the canonical media query.
assert.match(
  source,
  /\(prefers-reduced-motion:\s*reduce\)/,
  "hook reads the prefers-reduced-motion: reduce query",
);

// Subscribes to changes (the user can toggle the OS preference live).
assert.match(
  source,
  /addEventListener\(\s*"change"/,
  "hook subscribes to MediaQueryList change events",
);
assert.match(
  source,
  /removeEventListener\(\s*"change"/,
  "hook cleans up the listener on unmount",
);

// Imperative one-shot helper for event handlers / effects (hooks can't run there).
assert.match(
  source,
  /export function prefersReducedMotion\(\)\s*:\s*boolean/,
  "exports prefersReducedMotion() for non-hook contexts",
);
assert.match(
  source,
  /export function prefersReducedMotion[\s\S]{0,160}typeof window === "undefined"/,
  "prefersReducedMotion() guards window for SSR safety",
);
assert.match(
  source,
  /export function smoothScrollBehavior\(\)\s*:\s*ScrollBehavior/,
  "exports smoothScrollBehavior() returning a ScrollBehavior",
);

// Regression: JS smooth-scroll call sites must gate on the preference, because an
// explicit `behavior: "smooth"` option overrides the CSS scroll-behavior reset.
const callSites = [
  "../components/library-doc-preview.tsx",
  "../components/projects/project-row.tsx",
  "../components/board-kanban.tsx",
  "../components/salem/salem-widget.tsx",
];
for (const rel of callSites) {
  const src = readFileSync(new URL(rel, import.meta.url), "utf8");
  assert.doesNotMatch(
    src,
    /behavior:\s*"smooth"/,
    `${rel} must not pass a raw behavior: "smooth" (use smoothScrollBehavior())`,
  );
  assert.match(
    src,
    /smoothScrollBehavior\(\)/,
    `${rel} must route smooth scrolling through smoothScrollBehavior()`,
  );
}

// library-chat-panel keeps its ScrollBehavior param but must gate "smooth" on the preference.
{
  const src = readFileSync(new URL("../components/library-chat-panel.tsx", import.meta.url), "utf8");
  assert.match(
    src,
    /prefersReducedMotion\(\)/,
    "library-chat-panel must gate its smooth auto-scroll on prefersReducedMotion()",
  );
}

console.log("use-prefers-reduced-motion.test.ts OK");
