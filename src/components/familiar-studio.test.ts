// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./familiar-studio.tsx", import.meta.url), "utf8");

assert.match(source, /export function FamiliarStudio/, "Must export FamiliarStudio");
assert.match(source, /useFamiliarStudio/, "Must consume FamiliarStudio context");
assert.match(source, /activeFamiliarId/, "Reads activeFamiliarId from context");
assert.match(source, /Escape/, "Esc dismiss is wired");
assert.match(source, /familiar-studio__drawer/, "Drawer root class must be present");
assert.match(source, /familiar-studio__tabstrip/, "Tab strip class must be present");
assert.match(source, /role="dialog"/, "Drawer must have dialog role for a11y");
assert.match(source, /aria-label/, "Drawer must have an accessible name");
assert.match(source, /function HeaderName/, "Header must use inline-edit HeaderName component");
assert.match(source, /Click to rename/, "Static name button must hint at edit affordance");
assert.match(source, /familiar-studio__name--editing/, "Editing-state class must exist");
assert.match(source, /useDaemonSyncStatus/, "Footer subscribes to daemon sync status");
assert.match(source, /Saved locally, daemon offline/, "Daemon-offline indicator text present");

console.log("familiar-studio.test.ts: ok");
