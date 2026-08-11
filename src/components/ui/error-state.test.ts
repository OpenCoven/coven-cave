// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("./error-state.tsx", import.meta.url),
  "utf8",
);

// Exports the component and props type.
assert.match(source, /export function ErrorState\s*\(/, "exports ErrorState");
assert.match(source, /export type ErrorStateProps/, "exports ErrorStateProps");

// Failures announce by default, while duplicate dependent copies can opt out.
assert.match(source, /live\?: boolean/, "ErrorState exposes an announcement opt-out");
assert.match(source, /live = true/, "ErrorState announces by default");
assert.match(source, /role=\{live \? "alert" : undefined\}/, "ErrorState makes quiet copies non-live");

// Has icon, headline, subtitle, actions (retry-friendly).
for (const slot of ["icon", "headline", "subtitle", "actions"]) {
  assert.match(
    source,
    new RegExp(`\\b${slot}\\b`),
    `ErrorState exposes ${slot}`,
  );
}

// Default icon is the danger/warning glyph (ph:warning or ph:warning-circle).
assert.match(
  source,
  /ph:warning/,
  "ErrorState defaults to a warning icon if none supplied",
);

console.log("error-state.test.ts OK");
