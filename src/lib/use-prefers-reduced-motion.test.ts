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

console.log("use-prefers-reduced-motion.test.ts OK");
