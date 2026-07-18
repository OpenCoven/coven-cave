// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const modal = readFileSync(new URL("./new-card-modal.tsx", import.meta.url), "utf8");

assert.ok(modal.includes('import { Button } from "@/components/ui/button"'), "new-card modal action buttons use the shared Button primitive");
assert.ok(modal.includes('import { StandardSelect } from "@/components/ui/select"'), "new-card modal dropdowns use StandardSelect");
assert.doesNotMatch(modal, /<button\b/, "new-card modal should not hand-roll button controls");
assert.doesNotMatch(modal, /<select\b|<option\b/, "new-card modal should not use native select controls");
assert.doesNotMatch(modal, /rounded-md/, "new-card modal should use control radius tokens instead of hard-coded rounded-md");

// The project list is familiar-scoped and self-fetched (enabled: open), so while
// a fetch is in flight the modal must NOT offer the previous familiar's retained
// options — otherwise a mid-refetch pick reaches a project the new familiar can't
// access and the board chat-launch 403s. Gate the options on the loading flag.
assert.match(
  modal,
  /useProjects\(\{ familiarId, enabled: open \}\)/,
  "new-card modal fetches projects scoped to the assigned familiar, only while open",
);
assert.match(
  modal,
  /loading: projectsLoading/,
  "new-card modal reads the projects loading flag to gate the Project picker",
);
assert.match(
  modal,
  /projectsLoading \? \[\] : projects\.map/,
  "new-card modal suppresses stale project options while the scoped list is loading",
);

console.log("new-card-modal.test.ts: ok");
