// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./use-viewport.ts", import.meta.url), "utf8");

assert.match(
  source,
  /export function useIsMobile\(\)\s*:\s*boolean/,
  "exports useIsMobile() returning boolean",
);
assert.match(
  source,
  /export function useIsCoarsePointer\(\)\s*:\s*boolean/,
  "exports useIsCoarsePointer() returning boolean",
);
assert.match(
  source,
  /export function useVisualViewport\(\)\s*:\s*VisualViewportState/,
  "exports useVisualViewport()",
);

assert.match(
  source,
  /\(max-width:\s*767px\)/,
  "useIsMobile reads (max-width: 767px), matching the shell breakpoint",
);
assert.match(
  source,
  /\(pointer:\s*coarse\)/,
  "useIsCoarsePointer reads (pointer: coarse)",
);

const ssrGuardCount = (source.match(/typeof window === "undefined"/g) ?? []).length;
assert.ok(
  ssrGuardCount >= 3,
  `each hook must guard typeof window for SSR safety (found ${ssrGuardCount} guards)`,
);

assert.match(
  source,
  /window\.visualViewport/,
  "useVisualViewport reads window.visualViewport",
);
assert.match(
  source,
  /window\.innerHeight/,
  "useVisualViewport falls back to window.innerHeight",
);

const mqlSubscribe = (source.match(/mql\.addEventListener\(\s*"change"/g) ?? []).length;
assert.ok(
  mqlSubscribe >= 2,
  `useIsMobile + useIsCoarsePointer subscribe to MediaQueryList change events (found ${mqlSubscribe})`,
);
const mqlUnsubscribe = (source.match(/mql\.removeEventListener\(\s*"change"/g) ?? []).length;
assert.ok(
  mqlUnsubscribe >= 2,
  `media-query hooks clean up listeners on unmount (found ${mqlUnsubscribe})`,
);

assert.match(
  source,
  /vv\.addEventListener\(\s*"resize"/,
  "useVisualViewport subscribes to visualViewport resize",
);
assert.match(
  source,
  /vv\.removeEventListener\(\s*"resize"/,
  "useVisualViewport cleans up the resize listener",
);

console.log("use-viewport.test.ts OK");
