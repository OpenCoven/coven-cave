// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./familiar-dock.tsx", import.meta.url), "utf8");

assert.match(src, /export function FamiliarDock/, "exports FamiliarDock");
// All chip clears the scope (null) and reflects the no-filter state.
assert.match(src, /onFamiliarScopeChange\(null\)/, "All chip clears the scope to null");
assert.match(src, /aria-pressed=\{activeFamiliarId == null\}/, "All chip pressed when no familiar is active");
// Avatar select drives the global scope (filter), NOT a new chat.
assert.match(src, /onFamiliarScopeChange\(f\.id\)/, "avatar selects the familiar scope by id");
assert.doesNotMatch(src, /onNewChat/, "dock filters; it does not start chats");
// Add button quick-creates via the studio list (discoverable add path).
assert.match(src, /familiar-dock__add/, "renders the add button");

console.log("familiar-dock.test.ts OK");
