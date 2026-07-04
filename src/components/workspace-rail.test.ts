// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const src = readFileSync(new URL("./workspace-rail.tsx", import.meta.url), "utf8");

assert.match(src, /export function WorkspaceRail\(/, "exports WorkspaceRail");
assert.match(src, /className="workspace-rail"/, "root class");
assert.match(src, /aria-label="Code rail"/, "labels the rail region");
for (const t of ["Changes", "Files", "Terminal"]) {
  assert.match(src, new RegExp(`aria-label="${t}"`), `has a ${t} tab`);
}
assert.match(src, /SessionChangesPanel/, "Changes tab reuses SessionChangesPanel");
assert.match(src, /onTogglePin/, "pin control wired");
assert.match(src, /onCollapse/, "collapse control wired");
assert.match(src, /changeCount > 0/, "shows a change-count badge");
console.log("workspace-rail.test.ts OK");
