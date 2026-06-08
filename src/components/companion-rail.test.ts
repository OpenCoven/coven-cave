// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./companion-rail.tsx", import.meta.url), "utf8");

assert.match(source, /export function CompanionRail/, "Component must be named CompanionRail");
assert.match(source, /companion-rail__header/, "Header element with BEM class");
assert.match(source, /companion-rail__tabs/, "Tab strip element with BEM class");
assert.match(
  source,
  /type CompanionTab = "chat" \| "inspector" \| "memory"/,
  "Three-tab union must be exported by name",
);
assert.match(source, /Chat/, "Chat label rendered");
assert.match(source, /Inspector/, "Inspector label rendered");
assert.match(source, /Memory/, "Memory label rendered");
assert.match(source, /No familiar yet/, "Empty state copy when no familiar");
