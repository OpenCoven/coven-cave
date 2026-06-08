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

// role="alert" so failures announce.
assert.match(source, /role="alert"/, "ErrorState uses role=alert");

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
