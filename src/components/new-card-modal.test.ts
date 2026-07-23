// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const modal = readFileSync(new URL("./new-card-modal.tsx", import.meta.url), "utf8");
const projectFamiliars = readFileSync(new URL("../lib/use-project-familiars.ts", import.meta.url), "utf8");

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
  /const familiarPickerReady = !projectId \|\| \(eligibleFamiliarsLoaded && !eligibleFamiliarsLoading\)/,
  "new-card modal enables the complete roster for unscoped work and waits for authorization otherwise",
);
assert.match(
  modal,
  /eligibleFamiliars\.map\(\(familiar\)/,
  "new-card modal renders only the server-authorized familiar list",
);
assert.match(
  modal,
  /const familiarOptions = !projectId[\s\S]{0,500}\.{3}familiars\.map\(\(familiar\)/,
  "new-card modal preserves the complete familiar roster for unscoped cards",
);
assert.match(
  modal,
  /function Select\(\{[\s\S]{0,180}disabled = false,[\s\S]{0,500}<StandardSelect[\s\S]{0,360}disabled=\{disabled\}/,
  "the modal Select wrapper forwards the familiar picker's disabled state to StandardSelect",
);
assert.match(
  projectFamiliars,
  /const \[loadedProjectId, setLoadedProjectId\] = useState<string \| null>\(null\)/,
  "project-scoped familiar results retain the project that produced them",
);
assert.match(
  projectFamiliars,
  /loadedSuccessfully: enabled && Boolean\(projectId\) && loadedProjectId === projectId/,
  "a familiar roster from the previous project never enables the picker during a project change",
);
assert.match(
  projectFamiliars,
  /catch \{[\s\S]{0,220}finally/,
  "a failed familiar request leaves the dependent picker in its load-failure state without an unhandled rejection",
);
assert.match(
  projectFamiliars,
  /for \(const projectId of ids\) search\.append\("projectId", projectId\)/,
  "table project rosters are requested together so remote/hub installs do not repeat daemon lookups per project",
);

console.log("new-card-modal.test.ts: ok");
