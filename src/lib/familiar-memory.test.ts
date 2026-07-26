// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./familiar-memory.ts", import.meta.url), "utf8");

assert.match(source, /export function getActiveFamiliar\(\)/);
assert.match(source, /export function setActiveFamiliar\(id: string \| null\)/);
assert.match(source, /export function getLastSurface\(familiarId: string\)/);
assert.match(source, /export function setLastSurface\(familiarId: string, surface: string\)/);
assert.match(source, /cave:active-familiar/);
assert.match(source, /cave:familiar:\$\{familiarId\}:last-surface/);
assert.match(
  source,
  /typeof window === "undefined"/,
  "All readers must SSR-guard",
);
