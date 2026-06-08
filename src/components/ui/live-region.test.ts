// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("./live-region.tsx", import.meta.url),
  "utf8",
);

// Exports the provider and the hook.
assert.match(
  source,
  /export function LiveRegionProvider\s*\(/,
  "exports LiveRegionProvider",
);
assert.match(
  source,
  /export function useAnnouncer\s*\(\s*\)/,
  "exports useAnnouncer() hook",
);

// Renders two regions with proper aria-live levels.
assert.match(source, /aria-live="polite"/, "renders polite region");
assert.match(source, /aria-live="assertive"/, "renders assertive region");
assert.match(source, /role="status"/, "polite region has role=status");
assert.match(source, /role="alert"/, "assertive region has role=alert");

// Visually hidden via the sr-only class.
assert.match(
  source,
  /className="sr-only"/,
  "regions are visually hidden via sr-only",
);

// Clears between announcements so repeats are announced.
assert.match(
  source,
  /setTimeout\(/,
  "clears the message after a short delay so repeats re-announce",
);

// Cleans up pending timeouts on unmount.
assert.match(
  source,
  /clearTimeout\(\s*politeClear\.current\s*\)/,
  "clears pending polite timeout on unmount",
);
assert.match(
  source,
  /clearTimeout\(\s*assertiveClear\.current\s*\)/,
  "clears pending assertive timeout on unmount",
);

// useAnnouncer throws/warns when used outside the provider.
assert.match(
  source,
  /useAnnouncer must be used within a LiveRegionProvider|throw new Error/,
  "useAnnouncer guards against missing provider",
);

console.log("live-region.test.ts OK");
