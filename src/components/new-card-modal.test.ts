// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const modal = readFileSync(new URL("./new-card-modal.tsx", import.meta.url), "utf8");

assert.ok(modal.includes('import { Button } from "@/components/ui/button"'), "new-card modal action buttons use the shared Button primitive");
assert.ok(modal.includes('import { StandardSelect } from "@/components/ui/select"'), "new-card modal dropdowns use StandardSelect");
assert.doesNotMatch(modal, /<button\b/, "new-card modal should not hand-roll button controls");
assert.doesNotMatch(modal, /<select\b|<option\b/, "new-card modal should not use native select controls");
assert.doesNotMatch(modal, /rounded-md/, "new-card modal should use control radius tokens instead of hard-coded rounded-md");

// The Project is chosen first. Its server-filtered familiar list must not offer
// stale options while a project access lookup is in flight.
assert.match(
  modal,
  /useProjectFamiliars\(\{ projectId, enabled: open \}\)/,
  "new-card modal fetches familiars scoped to the selected project, only while open",
);
assert.match(
  modal,
  /loading: eligibleFamiliarsLoading/,
  "new-card modal reads the familiar lookup loading flag",
);
assert.match(
  modal,
  /const familiarPickerReady = Boolean\(projectId\) && eligibleFamiliarsLoaded && !eligibleFamiliarsLoading/,
  "new-card modal enables Familiar only after a project-scoped response succeeds",
);
assert.match(
  modal,
  /eligibleFamiliars\.map\(\(familiar\)/,
  "new-card modal renders only the server-authorized familiar list",
);

console.log("new-card-modal.test.ts: ok");
